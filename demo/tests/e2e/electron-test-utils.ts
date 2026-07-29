import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

const repoRoot = process.cwd()
const electronPath = createRequire(__filename)('electron') as string
const builtMain = join(repoRoot, 'demo', 'out', 'main', 'index.js')
const SENSITIVE_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'MOONMETER_EXCHANGE_ID',
  'MOONMETER_EXCHANGE_KEY',
  'TOKENLUB_EXCHANGE_ID',
  'TOKENLUB_EXCHANGE_KEY',
  'TOKENSCOPE_EXCHANGE_ID',
  'TOKENSCOPE_EXCHANGE_KEY'
]

export interface IsolatedElectronApp {
  app: ElectronApplication
  page: Page
  root: string
  userData: string
  databasePath: string
  close(): Promise<void>
}

export function assertTemporaryProfile(root: string, userData: string): void {
  const temporaryRoot = resolve(tmpdir())
  const rootRelative = relative(temporaryRoot, resolve(root))
  const userDataRelative = relative(resolve(root), resolve(userData))
  if (
    rootRelative === '' ||
    rootRelative.startsWith('..') ||
    isAbsolute(rootRelative) ||
    userDataRelative.startsWith('..') ||
    isAbsolute(userDataRelative)
  ) {
    throw new Error('Electron E2E requires a temporary profile contained by its test root')
  }
}

export function createIsolatedEnvironment(root: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env }
  for (const key of SENSITIVE_ENV_KEYS) delete environment[key]
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.NODE_OPTIONS

  const home = join(root, 'home')
  const appData = join(root, 'appdata')
  const localAppData = join(root, 'local-appdata')
  const xdgConfig = join(root, 'xdg-config')
  const xdgData = join(root, 'xdg-data')
  const kimiHome = join(home, '.kimi-code')
  for (const directory of [home, appData, localAppData, xdgConfig, xdgData, kimiHome]) {
    mkdirSync(directory, { recursive: true })
  }

  Object.assign(environment, {
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: '',
    HOMEPATH: home,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_DATA_HOME: xdgData,
    KIMI_CODE_HOME: kimiHome
  })
  return environment
}

export async function launchIsolatedElectron(
  prefix = 'moonmeter-electron-',
  environment?: NodeJS.ProcessEnv
): Promise<IsolatedElectronApp> {
  if (!existsSync(builtMain)) throw new Error('run npm run build before Electron E2E')
  const root = mkdtempSync(join(tmpdir(), prefix))
  const userData = join(root, 'user-data')
  assertTemporaryProfile(root, userData)
  mkdirSync(userData, { recursive: true })

  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: [
        '.',
        `--user-data-dir=${userData}`,
        '--disable-gpu',
        '--disable-background-networking',
        '--host-resolver-rules=MAP * 0.0.0.0,EXCLUDE localhost,EXCLUDE 127.0.0.1'
      ],
      cwd: repoRoot,
      env: { ...createIsolatedEnvironment(root), ...environment }
    })
    const page = await app.firstWindow()
    page.setDefaultTimeout(8_000)
    return {
      app,
      page,
      root,
      userData,
      databasePath: join(userData, 'moonmeter.db'),
      async close(): Promise<void> {
        await app?.close()
        app = undefined
        rmSync(root, { recursive: true, force: true })
      }
    }
  } catch (error) {
    await app?.close().catch(() => undefined)
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}
