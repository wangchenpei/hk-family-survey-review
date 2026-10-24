// Classic entry point can show an error even when an imported module fails.
(() => {
  const status = document.getElementById('status');
  const failure = text => { status.textContent = text; const authStatus = document.getElementById('authStatus'); if(authStatus) authStatus.textContent = text; };
  window.addEventListener('error', () => failure('工具运行出错，请刷新页面重试；如仍失败，请检查本地工具文件是否完整。'));
  window.addEventListener('unhandledrejection', () => failure('处理未完成，请刷新后重新导入；如仍失败，请检查本地服务与工具文件。'));
  if (location.protocol === 'file:') {
    failure('请使用“启动本地分析.cmd”打开工具，不要直接双击HTML文件。');
    return;
  }
  import('./cloud-ui.mjs').then(() => {
    status.textContent = '请导入腾讯问卷CSV文件，系统会自动识别并评分。';
  }).catch(() => {
    failure('工具模块加载失败，暂时无法分析。请刷新页面；如仍失败，请使用本地启动脚本，并检查app.mjs及其依赖文件是否完整。');
  });
})();
