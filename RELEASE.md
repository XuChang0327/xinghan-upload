# 发布与常用命令

方便后续发布新版本时查阅。

## 1. 本地 Git

```bash
# 修改版本号后：编译、打包
npm run esbuild
npm run package

# 提交（按需修改版本号与说明）
git add README.md package.json scripts/ src/ RELEASE.md
git status   # 确认不要提交 dist/、*.vsix（.gitignore 已忽略）
git commit -m "v0.7.1: 版本说明"

# 推送到远程（需先配置 remote，仅首次）
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

## 2. 发布到 Open VSX

先打包生成 `.vsix`（见上），再发布。**若已将 token 添加到环境变量 `OVSX_PAT`**，直接执行：

```bash
npx ovsx publish xinghan-upload-0.12.0.vsix --no-dependencies
```

未配置环境变量时，可临时导出或命令行传入：

```bash
# 临时导出（仅当前终端有效）
export OVSX_PAT="你的Open-VSX个人访问令牌"
npx ovsx publish xinghan-upload-0.12.0.vsix --no-dependencies

# 或命令行传入
npx ovsx publish xinghan-upload-0.12.0.vsix --no-dependencies -p 你的令牌
```

- 令牌获取：<https://open-vsx.org/user-settings/tokens>
- 首次需在 open-vsx.org 登录并签署 Publisher Agreement；命名空间需与 `package.json` 中 `publisher` 一致（如 `XuChang0327`）

## 3. 发布到 VS Code Marketplace

先打包生成 `.vsix`（见上），再发布。**若已将 token 添加到环境变量 `VSCE_PAT`**，直接执行：

```bash
npx @vscode/vsce publish --allow-missing-repository --skip-license
```

- 令牌获取：<https://dev.azure.com/>
- 发布账号需与 `package.json` 中 `publisher` 一致（如 `XuChang0327`）

## 4. 发布前检查

- [ ] `package.json` 中 `version` 已改为新版本（如 `0.12.0`）
- [ ] `README.md` 中「安装」与「打包」处的 vsix 文件名、更新日志已更新
- [ ] 执行 `npm run esbuild && npm run package` 无报错
