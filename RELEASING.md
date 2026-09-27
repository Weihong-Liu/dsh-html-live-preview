# Releasing

Releases are tag-driven: pushing a `v<version>` tag makes GitHub Actions publish
the package to npm and open a GitHub release. No local `npm publish` is needed.

## One-time setup: authorize this repository on npm

The workflow authenticates with **npm Trusted Publishing (OIDC)**, so no npm
token is stored in the repository.

1. Sign in at [npmjs.com](https://www.npmjs.com/) and open the package page →
   **Settings** → **Trusted Publisher**.
2. Choose **GitHub Actions** and fill in:
   - **Organization or user**: `Weihong-Liu`
   - **Repository**: `dsh-html-live-preview`
   - **Workflow filename**: `release.yml`
   - **Environment**: leave empty
3. Save. From then on, this repository's `release.yml` may publish the package
   without a token, and every published version carries a provenance
   attestation that npm displays on the package page.

<details>
<summary>Alternative: a classic npm token</summary>

If you would rather not use Trusted Publishing, create an **Automation** token
on npmjs.com, add it to the repository as the secret `NPM_TOKEN`, and add one
`env` block to the publish step in
[`.github/workflows/release.yml`](.github/workflows/release.yml):

```yaml
      - name: Publish to npm
        if: startsWith(github.ref, 'refs/tags/')
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: npm publish --provenance --access public
```

`--provenance` keeps working either way, because the attestation is signed with
the runner's OIDC token rather than with the npm credential.

</details>

## Cutting a release

```sh
# 1. Bump the version and update anything version-pinned in the docs
npm version patch     # or: minor / major, or edit package.json by hand

# 2. Push the commit and the tag it created
git push origin main --follow-tags
```

`npm version` writes the bump to `package.json`, commits it, and creates the
matching `v<version>` tag. The workflow then checks that the tag and the
manifest agree, runs the syntax check, prints the tarball contents, publishes,
and opens a GitHub release with generated notes.

Publishing a version that already exists on npm fails loudly — bump the version
instead of re-tagging.

## Dry runs

Run the **release** workflow manually from the Actions tab (or `gh workflow run
release.yml`): a manual run performs the version check, the syntax check and
`npm pack --dry-run`, and publishes nothing.

## 中文速览

- **一次性配置**：npmjs.com 上打开这个包的 Settings → Trusted Publisher，选 GitHub
  Actions，填 `Weihong-Liu` / `dsh-html-live-preview` / `release.yml`，保存即可
  （不需要在仓库里放 token）。不想用 OIDC 的话，就建一个 Automation token 存成
  仓库 secret `NPM_TOKEN`，并按上面的说明给 publish 步骤加 `env`。
- **发新版**：`npm version patch`（或 minor/major）→ `git push origin main --follow-tags`。
  工作流会校验 tag 与 package.json 版本一致，跑语法检查、打印打包清单、发布 npm，
  并自动创建 GitHub Release。
- **干跑**：在 Actions 页面手动运行 release 工作流，只校验 + 打包，不发布。
- 版本号已存在于 npm 时发布会失败（这是有意的），请改版本号而不是重打同一个 tag。
