---
name: map-location
description: 实现地图选点 + 位置服务 + 地理围栏
model: claude-4-sonnet
tags: [frontend, map]
depends_on: [wx-login]
---

# 任务：实现地图 + 位置服务

## 目标
完整的地图交互（选点/展示/导航）+ 位置纠偏 + 地理围栏打卡。

## 具体步骤

### 1. 腾讯地图工具封装 `utils/map.ts`
```typescript
import QQMapWX from '@/libs/qqmap-wx-jssdk.min.js';

const qqmapsdk = new QQMapWX({ key: import.meta.env.VITE_MAP_KEY });

// 逆地址解析（坐标→地址）
export function reverseGeocode(lat: number, lng: number): Promise<{
  address: string;
  province: string;
  city: string;
  district: string;
  street: string;
  poiName?: string;
}> {
  return new Promise((resolve, reject) => {
    qqmapsdk.reverseGeocoder({
      location: { latitude: lat, longitude: lng },
      success: (res) => resolve(res.result),
      fail: reject
    });
  });
}

// 关键词搜索POI
export function searchPOI(keyword: string, lat: number, lng: number) {
  return new Promise((resolve, reject) => {
    qqmapsdk.search({
      keyword,
      location: { latitude: lat, longitude: lng },
      radius: 3000,
      page_size: 20,
      success: (res) => resolve(res.data),
      fail: reject
    });
  });
}

// 距离计算（Haversine）
export function calcDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // 地球半径(m)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
             Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
             Math.sin(dLng/2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// 坐标纠偏（GCJ02 → WGS84 或反之）
export function gcj02ToWgs84(lat: number, lng: number): [number, number] {
  // 百度地图/腾讯地图用 GCJ02，GPS 用 WGS84
  const PI = Math.PI;
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  
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
```

### 2. 地图选点页 `pages/map/picker.vue`
```vue
<template>
  <view class="map-picker">
    <!-- 搜索栏 -->
    <view class="search-bar">
      <input v-model="keyword" placeholder="搜索地点" @confirm="onSearch" />
    </view>
    
    <!-- 地图 -->
    <map
      id="myMap"
      class="map"
      :latitude="lat"
      :longitude="lng"
      :markers="markers"
      scale="16"
      @tap="onMapTap"
      @regionchange="onRegionChange"
      show-location
    />
    
    <!-- 底部确认栏 -->
    <view class="bottom-bar">
      <view class="selected-info">
        <text class="label">已选位置</text>
        <text class="address">{{ selectedAddress || '请点击地图选择' }}</text>
      </view>
      <button class="confirm-btn" :disabled="!selectedAddress" @click="confirm">
        确认选择
      </button>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { reverseGeocode, searchPOI } from '@/utils/map';

const lat = ref(39.9042);
const lng = ref(116.4074);
const selectedAddress = ref('');
const markers = ref([]);

onMounted(() => {
  // 获取当前位置
  wx.getLocation({
    type: 'gcj02',
    success: (res) => {
      lat.value = res.latitude;
      lng.value = res.longitude;
      reverseGeocode(res.latitude, res.longitude).then(addr => {
        selectedAddress.value = addr.address;
      });
    }
  });
});

function onMapTap(e) {
  const { latitude, longitude } = e.detail;
  lat.value = latitude;
  lng.value = longitude;
  markers.value = [{
    id: 1,
    latitude, longitude,
    iconPath: '/static/marker.png',
    width: 32, height: 32
  }];
  reverseGeocode(latitude, longitude).then(addr => {
    selectedAddress.value = addr.address;
  });
}

function confirm() {
  const pages = getCurrentPages();
  const prevPage = pages[pages.length - 2];
  prevPage.setData({
    selectedLocation: {
      lat: lat.value,
      lng: lng.value,
      address: selectedAddress.value
    }
  });
  wx.navigateBack();
}
</script>
```

### 3. 任务地图展示页 `pages/map/tasks.vue`
```vue
<template>
  <view class="task-map">
    <map
      class="full-map"
      :latitude="center.lat"
      :longitude="center.lng"
      :markers="taskMarkers"
      :include-points="includePoints"
      scale="14"
      @markertap="onMarkerTap"
    />
    
    <!-- 底部任务卡片滑动条 -->
    <scroll-view class="task-cards" scroll-x>
      <task-card-mini
        v-for="t in nearbyTasks"
        :key="t.id"
        :task="t"
        @click="focusTask(t)"
      />
    </scroll-view>
  </view>
</template>
```

### 4. 导航功能 `utils/navigation.ts`
```typescript
export function openNavigation(lat: number, lng: number, name: string) {
  wx.openLocation({
    latitude: lat,
    longitude: lng,
    name: name,
    scale: 18,
    success: () => console.log('导航已打开'),
    fail: () => {
      // 降级：复制地址到剪贴板
      wx.setClipboardData({ data: `${lat},${lng}` });
      wx.showToast({ title: '坐标已复制', icon: 'success' });
    }
  });
}
```

### 5. 地理围栏打卡 `utils/geofence.ts`
```typescript
import { calcDistance } from './map';

const FENCE_RADIUS = 500; // 500米

export function checkInFence(
  taskLat: number, taskLng: number,
  currentLat: number, currentLng: number
): { inFence: boolean; distance: number } {
  const distance = calcDistance(taskLat, taskLng, currentLat, currentLng);
  return {
    inFence: distance <= FENCE_RADIUS,
    distance: distance
  };
}

// 持续监听位置（骑手模式）
export function startLocationWatch(taskLat: number, taskLng: number, onUpdate: (dist: number) => void) {
  return wx.startLocationUpdate({
    type: 'gcj02',
    success: () => {
      const handler = (res) => {
        const dist = calcDistance(taskLat, taskLng, res.latitude, res.longitude);
        onUpdate(dist);
      };
      wx.onLocationChange(handler);
    }
  });
}

export function stopLocationWatch() {
  wx.stopLocationUpdate();
  wx.offLocationChange();
}
```

### 6. 对应需求条目
#11, #17, #84, #85

## 验收标准
- [ ] 地图选点准确（GCJ02 坐标）
- [ ] 逆地址解析正确
- [ ] 搜索 POI 结果准确
- [ ] 导航跳转正常
- [ ] 地理围栏 500m 判定正确
- [ ] 持续定位不耗电（后台限制）
- [ ] 坐标纠偏准确

## 参考文件
- `specs/02-task.md` → 位置选择
- `.trae/memory.md` → 已知坑（iOS 精度差）
