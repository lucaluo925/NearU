const colors = { reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', gray: '\x1b[90m', cyan: '\x1b[36m' }

export const log = {
  info:    (msg) => console.log(`${colors.cyan}[info]${colors.reset}  ${msg}`),
  ok:      (msg) => console.log(`${colors.green}[ok]${colors.reset}    ${msg}`),
  warn:    (msg) => console.warn(`${colors.yellow}[warn]${colors.reset}   ${msg}`),
  error:   (msg) => console.error(`${colors.red}[error]${colors.reset}  ${msg}`),
  skip:    (msg) => console.log(`${colors.gray}[skip]${colors.reset}   ${msg}`),
  section: (msg) => console.log(`\n${colors.cyan}━━━ ${msg} ━━━${colors.reset}`),
}
