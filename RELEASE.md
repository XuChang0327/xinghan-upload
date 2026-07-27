# 发布与常用命令

方便后续发布新版本时查阅。

## 1. 编译打包

```bash
# 修改 package.json 中的版本号后：
npm run esbuild
npm run package
```

## 2. 提交并推送到 GitHub

```bash
git add README.md package.json scripts/ src/ RELEASE.md
git status   # 确认不要提交 dist/、*.vsix（.gitignore 已忽略）
git commit -m "v0.15.2: 版本说明"
git push origin main
```

## 3. 发布到 GitHub Release

使用 `gh` CLI 创建 Release 并上传 `.vsix` 插件包：

```bash
# 创建 release 并附带 .vsix 文件（VERSION 替换为实际版本号）
gh release create v0.15.2 ./xinghan-upload-0.15.2.vsix \
  --title "v0.15.2" \
  --notes "版本说明"
```

如需从草稿发布或标记为预发布版本：

```bash
# 草稿模式（不立即公开）
gh release create v0.15.2 ./xinghan-upload-0.15.2.vsix --draft --title "v0.15.2" --notes "版本说明"

# 预发布
gh release create v0.15.2 ./xinghan-upload-0.15.2.vsix --prerelease --title "v0.15.2" --notes "版本说明"
```

- 仓库地址：<https://github.com/XuChang0327/xinghan-upload>
- `gh` CLI 需先登录：`gh auth login`

## 4. 发布到 Open VSX

先打包生成 `.vsix`（见上），再发布。**若已将 token 添加到环境变量 `OVSX_PAT`**，直接执行：

```bash
npx ovsx publish xinghan-upload-0.15.2.vsix --no-dependencies
```

未配置环境变量时，可临时导出或命令行传入：

```bash
export OVSX_PAT="你的Open-VSX个人访问令牌"
npx ovsx publish xinghan-upload-0.15.2.vsix --no-dependencies
```

- 令牌获取：<https://open-vsx.org/user-settings/tokens>
- 首次需在 open-vsx.org 登录并签署 Publisher Agreement；命名空间需与 `package.json` 中 `publisher` 一致（如 `XuChang0327`）

## 5. 发布到 VS Code Marketplace

```bash
npx @vscode/vsce publish --allow-missing-repository --skip-license
```

- 令牌获取：<https://dev.azure.com/>
- 发布账号需与 `package.json` 中 `publisher` 一致（如 `XuChang0327`）

## 6. 发布前检查

> **重要：每次推送到 GitHub 或发布到插件市场之前，必须先更新 README.md 文档。**

- [ ] **更新 `README.md`**（安装说明中的 vsix 文件名、版本号、更新日志等）
- [ ] `package.json` 中 `version` 已改为新版本
- [ ] 执行 `npm run esbuild && npm run package` 无报错
- [ ] Git 提交并推送到 GitHub
- [ ] GitHub Release 已创建并附带 `.vsix` 文件

## 快速发布（一键流程）

```bash
# 假设版本号为 X.Y.Z，替换下方所有 X.Y.Z
npm run esbuild && npm run package
git add README.md package.json scripts/ src/ RELEASE.md
git commit -m "vX.Y.Z: 版本说明"
git push origin main
gh release create vX.Y.Z ./xinghan-upload-X.Y.Z.vsix --title "vX.Y.Z" --notes "版本说明"
npx ovsx publish xinghan-upload-X.Y.Z.vsix --no-dependencies
npx @vscode/vsce publish --allow-missing-repository --skip-license
```
