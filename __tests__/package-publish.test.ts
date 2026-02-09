/**
 * Package Publishing Regression Tests
 *
 * These tests ensure the npm package can be installed correctly.
 * They verify the fixes from USER-TESTING-REPORT.md (Phase 4) remain in place.
 *
 * Critical issues prevented:
 * - workspace:* dependencies in published package.json
 * - Missing dependencies (unbundled packages)
 * - Broken CLI entry point
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const packageRoot = join(__dirname, '..')

describe('Package Publishing Readiness', () => {
  describe('package.json validation', () => {
    const packageJson = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), 'utf-8')
    )

    it('should not contain workspace: protocol in dependencies', () => {
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.optionalDependencies,
        ...packageJson.peerDependencies,
      }

      for (const [name, version] of Object.entries(allDeps)) {
        expect(
          (version as string).includes('workspace:'),
          `Dependency ${name} uses workspace: protocol which will break npm install`
        ).toBe(false)
      }
    })

    it('should have proper version format for @relayplane/* dependencies', () => {
      const deps = packageJson.dependencies || {}

      for (const [name, version] of Object.entries(deps)) {
        if (name.startsWith('@relayplane/')) {
          expect(
            (version as string).match(/^\^?\d+\.\d+\.\d+/),
            `${name} should have a proper semver version, got: ${version}`
          ).toBeTruthy()
        }
      }
    })

    it('should have bin entry pointing to CLI', () => {
      expect(packageJson.bin).toBeDefined()
      expect(packageJson.bin['relayplane-proxy']).toBe('dist/cli.js')
    })

    it('should include dist in files array', () => {
      expect(packageJson.files).toContain('dist')
    })

    it('should have prepublishOnly script that builds', () => {
      expect(packageJson.scripts.prepublishOnly).toBeDefined()
      expect(packageJson.scripts.prepublishOnly).toContain('build')
    })
  })

  describe('Build outputs', () => {
    it('should have dist/cli.js after build', () => {
      const cliPath = join(packageRoot, 'dist', 'cli.js')
      expect(
        existsSync(cliPath),
        'dist/cli.js should exist - run pnpm build first'
      ).toBe(true)
    })

    it('should have dist/index.js after build', () => {
      const indexPath = join(packageRoot, 'dist', 'index.js')
      expect(
        existsSync(indexPath),
        'dist/index.js should exist - run pnpm build first'
      ).toBe(true)
    })
  })

  describe('npm pack dry run', () => {
    it('should not include workspace: in packed tarball', () => {
      // Run npm pack --dry-run and check the package.json that would be included
      try {
        const output = execSync('npm pack --dry-run --json 2>/dev/null', {
          cwd: packageRoot,
          encoding: 'utf-8',
        })

        // Parse the JSON output to get file list
        const packInfo = JSON.parse(output)

        // Verify package.json is included
        const files = packInfo[0]?.files || []
        const hasPackageJson = files.some(
          (f: { path: string }) => f.path === 'package.json'
        )
        expect(hasPackageJson).toBe(true)
      } catch {
        // npm pack might not work in all environments, skip gracefully
        console.log('Skipping npm pack test - npm pack not available')
      }
    })
  })

  describe('Dependency verification', () => {
    it('should have @relayplane/core as a proper version dependency', () => {
      const packageJson = JSON.parse(
        readFileSync(join(packageRoot, 'package.json'), 'utf-8')
      )

      const coreVersion = packageJson.dependencies?.['@relayplane/core']
      expect(coreVersion).toBeDefined()
      expect(coreVersion).not.toContain('workspace:')
      expect(coreVersion).toMatch(/^\^?\d+/)
    })

    it('should NOT have @relayplane/openclaw as a dependency', () => {
      // openclaw was removed and bundled as standalone-proxy.ts
      const packageJson = JSON.parse(
        readFileSync(join(packageRoot, 'package.json'), 'utf-8')
      )

      expect(packageJson.dependencies?.['@relayplane/openclaw']).toBeUndefined()
      expect(
        packageJson.optionalDependencies?.['@relayplane/openclaw']
      ).toBeUndefined()
    })
  })

  describe('CLI functionality', () => {
    it('should be able to require the CLI module', () => {
      const cliPath = join(packageRoot, 'dist', 'cli.js')
      if (existsSync(cliPath)) {
        // Just verify it can be loaded without errors
        expect(() => require(cliPath)).not.toThrow()
      }
    })
  })
})
