declare const runtime: {
  showLoading: boolean;
  loadingText: string;
  webview: {
    enableJavaScript: boolean;
    enableDomStorage: boolean;
    allowFileAccess: boolean;
    mixedContentMode: 'never' | 'always' | 'compatibility';
    // 支持三种写法:
    //   '#ffffff' / 'white'          → 固定色
    //   'system'                     → 跟随系统
    //   { light: '#fff', dark: '#000' } → 按系统主题切换
    backgroundColor: string | { light: string; dark: string };
  };
};
export default runtime;