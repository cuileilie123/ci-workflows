/// <reference types="vite/client" />

declare module '*.vue' {
  import { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>
  export default component
}

// uni-app 页面生命周期函数类型定义
declare function onLoad(options: any): void;
declare function onShow(): void;
declare function onShareAppMessage(): {
  title: string;
  path: string;
  imageUrl?: string;
  desc?: string;
};
declare function onShareTimeline(): {
  title: string;
  query: string;
  imageUrl?: string;
};

// 定义分享选项接口
interface OnShareAppMessageOptions {
  title: string;
  path: string;
  imageUrl?: string;
  desc?: string;
}

interface OnShareTimelineOptions {
  title: string;
  query: string;
  imageUrl?: string;
}

// 腾讯地图 SDK 类型定义
declare class QQMapWX {
  constructor(options: { key: string });
  reverseGeocoder(options: {
    location: { latitude: number; longitude: number };
    success: (res: any) => void;
    fail?: (err: any) => void;
  }): void;
  search(options: {
    keyword: string;
    location: { latitude: number; longitude: number };
    radius?: number;
    page_size?: number;
    success: (res: any) => void;
    fail?: (err: any) => void;
  }): void;
}

declare namespace NodeJS {
  interface ImportMetaEnv {
    VITE_API_BASE_URL: string;
    VITE_WX_APPID: string;
    VITE_MAP_KEY: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
