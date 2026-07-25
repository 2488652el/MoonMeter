import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const window = {
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      isLoading: vi.fn(() => false),
      once: vi.fn(),
      send: vi.fn()
    }
  }
  return {
    supported: true,
    handlers,
    windows: [window],
    window,
    notificationShow: vi.fn(),
    events: [] as Array<Record<string, unknown>>
  }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => state.windows)
  },
  Notification: class {
    static isSupported() {
      return state.supported
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      state.handlers.set(event, handler)
      return this
    }

    show() {
      state.notificationShow()
    }
  }
}))

vi.mock('../../../code/src/main/window', () => ({
  createWindow: vi.fn(() => state.window)
}))

vi.mock('../../../code/src/main/store/alerts-repo', () => ({
  listAlertEvents: vi.fn(() => state.events)
}))

import {
  getAlertNotificationStatus,
  showAlertNotification
} from '../../../code/src/main/services/alert-notifications'

const event = {
  id: 'event-1',
  ruleId: 'rule-1',
  providerId: 'openai-admin',
  firedAt: '2026-07-25T00:00:00.000Z',
  value: 5,
  threshold: 10,
  message: 'remaining is low',
  notificationStatus: 'pending' as const
}

describe('native alert notification delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.handlers.clear()
    state.supported = true
    state.windows = [state.window]
    state.events = []
    state.window.isMinimized.mockReturnValue(false)
    state.window.webContents.isLoading.mockReturnValue(false)
  })

  it('reports unsupported runtimes without attempting delivery', () => {
    state.supported = false
    const onDelivery = vi.fn()

    expect(getAlertNotificationStatus()).toMatchObject({
      supported: false,
      state: 'unsupported'
    })
    expect(showAlertNotification(event, onDelivery)).toEqual({ status: 'unsupported' })
    expect(onDelivery).toHaveBeenCalledWith({ status: 'unsupported' })
    expect(state.notificationShow).not.toHaveBeenCalled()
  })

  it('distinguishes unverified support from a confirmed delivery', () => {
    expect(getAlertNotificationStatus()).toMatchObject({
      supported: true,
      state: 'unverified'
    })

    state.events = [{ ...event, notificationStatus: 'shown' }]
    expect(getAlertNotificationStatus()).toMatchObject({
      supported: true,
      state: 'delivered',
      lastDeliveryStatus: 'shown',
      lastAttemptAt: event.firedAt
    })
  })

  it('surfaces the latest native failure as a permission or delivery problem', () => {
    state.events = [
      {
        ...event,
        notificationStatus: 'failed',
        notificationError: 'Notifications are not allowed'
      }
    ]

    expect(getAlertNotificationStatus()).toMatchObject({
      supported: true,
      state: 'blocked-or-failed',
      lastDeliveryStatus: 'failed',
      detail: expect.stringContaining('Notifications are not allowed')
    })
  })

  it('keeps delivery pending until Electron confirms show and settles only once', () => {
    const onDelivery = vi.fn()

    expect(showAlertNotification(event, onDelivery)).toEqual({ status: 'pending' })
    expect(onDelivery).not.toHaveBeenCalled()

    state.handlers.get('show')?.()
    expect(onDelivery).toHaveBeenCalledTimes(1)
    expect(onDelivery).toHaveBeenCalledWith({ status: 'shown' })

    state.handlers.get('failed')?.({}, 'late failure')
    expect(onDelivery).toHaveBeenCalledTimes(1)
  })

  it('records an asynchronous native notification failure', () => {
    const onDelivery = vi.fn()

    expect(showAlertNotification(event, onDelivery)).toEqual({ status: 'pending' })
    state.handlers.get('failed')?.({}, 'permission denied')

    expect(onDelivery).toHaveBeenCalledWith({
      status: 'failed',
      error: 'permission denied'
    })
  })

  it('records a synchronous show failure instead of leaving the event pending', () => {
    const onDelivery = vi.fn()
    state.notificationShow.mockImplementationOnce(() => {
      throw new Error('native show failed')
    })

    expect(showAlertNotification(event, onDelivery)).toEqual({
      status: 'failed',
      error: 'native show failed'
    })
    expect(onDelivery).toHaveBeenCalledWith({
      status: 'failed',
      error: 'native show failed'
    })
  })

  it('delivers while foreground/background and focuses the existing window on click', () => {
    expect(showAlertNotification(event)).toEqual({ status: 'pending' })
    expect(state.notificationShow).toHaveBeenCalledTimes(1)

    state.handlers.get('click')?.()

    expect(state.window.restore).not.toHaveBeenCalled()
    expect(state.window.show).toHaveBeenCalled()
    expect(state.window.focus).toHaveBeenCalled()
    expect(state.window.webContents.send).toHaveBeenCalledWith(
      'subscribe:alerts-open-destination',
      { eventId: 'event-1', providerId: 'openai-admin' }
    )
  })

  it('restores a minimized window before routing the notification click', () => {
    state.window.isMinimized.mockReturnValue(true)

    showAlertNotification(event)
    state.handlers.get('click')?.()

    expect(state.window.restore).toHaveBeenCalled()
    expect(state.window.show).toHaveBeenCalled()
    expect(state.window.focus).toHaveBeenCalled()
  })

  it('waits for a newly created renderer before sending the destination', async () => {
    state.windows = []
    state.window.webContents.isLoading.mockReturnValue(true)

    showAlertNotification(event)
    state.handlers.get('click')?.()

    expect(state.window.webContents.once).toHaveBeenCalledWith(
      'did-finish-load',
      expect.any(Function)
    )
    const finish = state.window.webContents.once.mock.calls[0]?.[1] as (() => void) | undefined
    finish?.()
    expect(state.window.webContents.send).toHaveBeenCalledWith(
      'subscribe:alerts-open-destination',
      { eventId: 'event-1', providerId: 'openai-admin' }
    )
  })
})
