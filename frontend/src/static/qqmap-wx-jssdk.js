/**
 * 腾讯地图微信小程序 SDK - 存根文件
 * 
 * ⚠️ 这是一个存根实现，仅用于在未下载真实 SDK 时避免运行时崩溃。
 * 真实 SDK 下载地址：https://lbs.qq.com/miniProgram/jsSdk/jsSdkGuide/jsSdkOverview
 * 下载后请将 qqmap-wx-jssdk.js 覆盖本文件（保持文件名一致）。
 *
 * 存根能力：
 *  - 构造函数：记录 key，不抛出异常
 *  - reverseGeocoder：返回失败回调（fail），提示 SDK 未正确安装
 *  - search：返回失败回调（fail），提示 SDK 未正确安装
 *
 * 使用方式（真实 SDK 安装后不需要改下面的代码）：
 *   import '@/static/qqmap-wx-jssdk.js';
 *   const sdk = new QQMapWX({ key: 'YOUR_KEY' });
 *   sdk.reverseGeocoder({ location: { lat, lng }, success, fail });
 */
(
  /** @this {any} */
  function (root) {
    function NoopQQMapWX(options) {
      this._key = options && options.key ? options.key : '';
      this._installed = false;
      // 标记为存根，方便调试
      root.qqmapsdk_stub_active = true;
    }

    function stubWarn(method) {
      var msg =
        '[QQMapWX-存根] 正在调用 ' +
        method +
        '，但真实 SDK 未安装。请从 https://lbs.qq.com/miniProgram/jsSdk 下载并替换 static/qqmap-wx-jssdk.js';
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(msg);
      }
      return { status: -9001, message: msg };
    }

    NoopQQMapWX.prototype.reverseGeocoder = function (opts) {
      var result = stubWarn('reverseGeocoder');
      if (opts && typeof opts.fail === 'function') {
        setTimeout(function () { opts.fail(result); }, 0);
      }
      if (opts && typeof opts.complete === 'function') {
        setTimeout(function () { opts.complete(result); }, 0);
      }
    };

    NoopQQMapWX.prototype.search = function (opts) {
      var result = stubWarn('search');
      if (opts && typeof opts.fail === 'function') {
        setTimeout(function () { opts.fail(result); }, 0);
      }
      if (opts && typeof opts.complete === 'function') {
        setTimeout(function () { opts.complete(result); }, 0);
      }
    };

    NoopQQMapWX.prototype.getDistance = function (opts) {
      var result = stubWarn('getDistance');
      if (opts && typeof opts.fail === 'function') {
        setTimeout(function () { opts.fail(result); }, 0);
      }
    };

    NoopQQMapWX.prototype.geocoder = function (opts) {
      var result = stubWarn('geocoder');
      if (opts && typeof opts.fail === 'function') {
        setTimeout(function () { opts.fail(result); }, 0);
      }
    };

    NoopQQMapWX.prototype.getCityList = function (opts) {
      var result = stubWarn('getCityList');
      if (opts && typeof opts.fail === 'function') {
        setTimeout(function () { opts.fail(result); }, 0);
      }
    };

    NoopQQMapWX.prototype.getDistrictByCityId = function (opts) {
      var result = stubWarn('getDistrictByCityId');
      if (opts && typeof opts.fail === 'function') {
        setTimeout(function () { opts.fail(result); }, 0);
      }
    };

    NoopQQMapWX.prototype.calculateDistance = function (opts) {
      var result = stubWarn('calculateDistance');
      if (opts && typeof opts.fail === 'function') {
        setTimeout(function () { opts.fail(result); }, 0);
      }
    };

    // 暴露到全局，与真实 SDK 行为一致
    if (typeof root.QQMapWX === 'undefined') {
      root.QQMapWX = NoopQQMapWX;
    }
  }
)(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
