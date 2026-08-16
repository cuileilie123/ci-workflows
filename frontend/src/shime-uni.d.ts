export {}

declare module "vue" {
  type Hooks = App.AppInstance & Page.PageInstance;
  interface ComponentCustomOptions extends Hooks {}
}

// 微信小程序 API 类型定义
declare const uni: UniNamespace.Uni;
declare const getCurrentPages: () => any[];

// 微信小程序特定 API 类型
interface WxAPI {
  requestSubscribeMessage(options: {
    tmplIds: string[];
    success?: (res: any) => void;
    fail?: (err: any) => void;
    complete?: (res: any) => void;
  }): void;
  onAppHide(callback: () => void): void;
}

declare namespace UniNamespace {
  interface Uni {
    getStorageSync(key: string): any;
    onUnload?(callback: () => void): void;
  }
}

// 全局作用域中的微信 API
declare global {
  var wx: WxAPI;
  var getCurrentPages: () => any[];
}