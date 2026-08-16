// 腾讯地图工具封装

interface GeocodeResult {
  address: string;
  province: string;
  city: string;
  district: string;
  street: string;
  poiName?: string;
}

interface ReverseGeocodeResponse {
  result: GeocodeResult;
}

interface POIItem {
  id?: string;
  title: string;
  address: string;
  location: { lat: number; lng: number };
}

export type { POIItem };

interface SearchPOIResponse {
  data: POIItem[];
}

/** 安全读取已初始化的腾讯地图 SDK 实例 */
function getMapSdk(): QQMapWX | null {
  const sdk = (globalThis as Record<string, unknown>).qqmapsdk;
  return (sdk as QQMapWX) ?? null;
}

// 逆地址解析（坐标→地址）
export function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult> {
  return new Promise((resolve, reject) => {
    const qqmapsdk = getMapSdk();
    if (!qqmapsdk) {
      reject(new Error('地图 SDK 未初始化'));
      return;
    }

    qqmapsdk.reverseGeocoder({
      location: { latitude: lat, longitude: lng },
      success: (res: ReverseGeocodeResponse) => resolve(res.result),
      fail: reject,
    });
  });
}

// 关键词搜索POI
export function searchPOI(keyword: string, lat: number, lng: number): Promise<POIItem[]> {
  return new Promise((resolve, reject) => {
    const qqmapsdk = getMapSdk();
    if (!qqmapsdk) {
      reject(new Error('地图 SDK 未初始化'));
      return;
    }

    qqmapsdk.search({
      keyword,
      location: { latitude: lat, longitude: lng },
      radius: 3000,
      page_size: 20,
      success: (res: SearchPOIResponse) => resolve(res.data),
      fail: reject,
    });
  });
}

// 距离计算（Haversine）
export function calcDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
             Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
             Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// 坐标纠偏（GCJ02 → WGS84）
export function gcj02ToWgs84(lat: number, lng: number): [number, number] {
  const PI = Math.PI;
  const a = 6378245.0;
  const ee = 0.006693421622965943;

  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI);

  return [lat - dLat, lng - dLng];
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}
