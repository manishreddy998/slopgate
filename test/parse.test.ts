import { describe, expect, it } from 'vitest'
import { parseRequirementsTxt, parseShell } from '../src/parse/command.js'

function names(script: string): string[] {
  return parseShell(script).packages.map((pkg) => `${pkg.ecosystem}:${pkg.name}`)
}

describe('parseShell', () => {
  it('reads npm installs, including scopes, versions, flags, and aliases', () => {
    expect(names('npm install react-codeshift')).toEqual(['npm:react-codeshift'])
    expect(names('npm i -D typescript @types/node@22')).toEqual(['npm:typescript', 'npm:@types/node'])
    expect(names('npm install --save-dev --ignore-scripts left-pad')).toEqual(['npm:left-pad'])
    expect(parseShell('npm install --ignore-scripts left-pad').packages[0]?.ignoreScripts).toBe(true)
    expect(names('npm install react@19.0.0 react-dom')).toEqual(['npm:react', 'npm:react-dom'])
    expect(names('npm install alias@npm:lodash@4.17.21')).toEqual(['npm:lodash'])
    expect(names('npm --registry https://npm.example.com install react')).toEqual(['npm:react'])
    expect(parseShell('npm --registry https://npm.example.com install react').packages[0]?.customRegistry).toBe(
      true,
    )
    expect(names('npm install ./local git+https://github.com/foo/bar.git')).toEqual([])
    expect(names('npm test')).toEqual([])
    expect(names('npm ci')).toEqual([])
  })

  it('reads npx, pnpm, yarn, and bun runners', () => {
    expect(names('npx --yes react-codeshift --transform=react-codeshift/transforms/foo.js ./src')).toEqual([
      'npm:react-codeshift',
    ])
    expect(names('npx -p cowsay -p lolcatjs cowsay hello')).toEqual(['npm:cowsay', 'npm:lolcatjs'])
    expect(names('pnpm add -D typescript eslint')).toEqual(['npm:typescript', 'npm:eslint'])
    expect(names('pnpm install')).toEqual([])
    expect(names('pnpm dlx react-codeshift')).toEqual(['npm:react-codeshift'])
    expect(names('yarn add lodash@4.17.21')).toEqual(['npm:lodash'])
    expect(names('yarn global add serve')).toEqual(['npm:serve'])
    expect(names('yarn dlx create-vite')).toEqual(['npm:create-vite'])
    expect(names('yarn create vite')).toEqual(['npm:create-vite'])
    expect(names('bun add -d @types/react')).toEqual(['npm:@types/react'])
    expect(names('bunx react-codeshift')).toEqual(['npm:react-codeshift'])
    expect(names('bun install')).toEqual([])
  })

  it('reads python, rust, and go installers', () => {
    expect(names('pip install requests==2.31.0')).toEqual(['pypi:requests'])
    expect(names("pip install 'Flask>=2'")).toEqual(['pypi:flask'])
    expect(names('pip install "requests[security]>=2.28"')).toEqual(['pypi:requests'])
    expect(parseShell('pip install -r requirements.txt').requirementFiles).toEqual([
      { ecosystem: 'pypi', path: 'requirements.txt' },
    ])
    expect(names('python3 -m pip install flask')).toEqual(['pypi:flask'])
    expect(names('uv add --dev ruff')).toEqual(['pypi:ruff'])
    expect(names('uv pip install pytest')).toEqual(['pypi:pytest'])
    expect(names('uvx ruff')).toEqual(['pypi:ruff'])
    expect(names('uvx --from ruff ruff check .')).toEqual(['pypi:ruff'])
    expect(names('poetry add django@^4.2')).toEqual(['pypi:django'])
    expect(names('cargo add serde tokio')).toEqual(['cargo:serde', 'cargo:tokio'])
    expect(names('cargo add serde --features derive')).toEqual(['cargo:serde'])
    expect(names('cargo install ripgrep --version 14.1.0')).toEqual(['cargo:ripgrep'])
    expect(parseShell('cargo add serde --git https://github.com/serde-rs/serde').packages[0]?.customRegistry).toBe(
      true,
    )
    expect(names('go get github.com/gin-gonic/gin@latest')).toEqual(['go:github.com/gin-gonic/gin'])
    expect(names('go install github.com/spf13/cobra-cli@v1.3.0')).toEqual(['go:github.com/spf13/cobra-cli'])
    expect(names('go get ./...')).toEqual([])
    expect(names('go install fmt')).toEqual([])
  })

  it('keeps chained commands and ignores comments, sudo, and unrelated tools', () => {
    expect(names('cd app && npm install react-codeshift')).toEqual(['npm:react-codeshift'])
    expect(names('npm install react && pip install flask')).toEqual(['npm:react', 'pypi:flask'])
    expect(names('npm install react # not flask')).toEqual(['npm:react'])
    expect(names('FOO=1 sudo -n npm install -g typescript')).toEqual(['npm:typescript'])
    expect(names('git commit -m "npm install react"')).toEqual([])
    expect(names('echo npm install react')).toEqual([])
    expect(names('npm install react \\\n react-dom')).toEqual(['npm:react', 'npm:react-dom'])
  })
})

describe('parseRequirementsTxt', () => {
  it('reads names, extras, markers, includes, and editables', () => {
    const parsed = parseRequirementsTxt(`
# comment
requests==2.31.0
Flask>=2.0 ; python_version >= "3.8"
package[extra]==1.0
-r other.txt
-e git+https://github.com/example/private.git
./local-path
`)
    expect(parsed.packages.map((pkg) => pkg.name)).toEqual(['requests', 'flask', 'package'])
    expect(parsed.files).toEqual(['other.txt'])
  })
})
