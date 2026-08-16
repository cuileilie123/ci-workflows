// 地理围栏工具
import { calcDistance } from './map';

const FENCE_RADIUS = 500; // 500米

interface LocationChangeResult {
  latitude?: number;
  longitude?: number;
}

export function checkInFence(
  taskLat: number,
  taskLng: number,
  currentLat: number,
  currentLng: number,
): { inFence: boolean; distance: number } {
  const distance = calcDistance(taskLat, taskLng, currentLat, currentLng);
  return {
    inFence: distance <= FENCE_RADIUS,
    distance,
  };
}

let locationWatchHandler: ((res: LocationChangeResult) => void) | null = null;

// 持续监听位置（骑手模式）
export function startLocationWatch(
  taskLat: number,
  taskLng: number,
  onUpdate: (dist: number) => void,
): void {
  uni.startLocationUpdate({
    type: 'gcj02',
    success: () => {
      locationWatchHandler = (res: LocationChangeResult) => {
        if (res.latitude == null || res.longitude == null) return;
        const dist = calcDistance(taskLat, taskLng, res.latitude, res.longitude);
        onUpdate(dist);
      };
      uni.onLocationChange(locationWatchHandler);
    },
    fail: (err) => {
      console.error('[Geofence] 启动位置监听失败', err);
    },
  });
}

export function stopLocationWatch(): void {
  if (locationWatchHandler) {
    uni.offLocationChange(locationWatchHandler);
    locationWatchHandler = null;
  }
  uni.stopLocationUpdate();
}
