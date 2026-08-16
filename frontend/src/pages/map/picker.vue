<template>
  <view class="map-picker">
    <!-- 搜索栏 -->
    <view class="search-bar">
      <input
        v-model="keyword"
        class="search-input"
        placeholder="搜索地点"
        placeholder-class="placeholder"
        @confirm="onSearch"
      />
    </view>

    <!-- 地图 -->
    <map
      id="myMap"
      class="map"
      :latitude="lat"
      :longitude="lng"
      :markers="markers"
      :scale="16"
      show-location
      @tap="onMapTap"
    />

    <!-- POI 搜索结果列表 -->
    <scroll-view v-if="showPOIList" class="poi-list" scroll-y>
      <view v-for="poi in poiResults" :key="poi.id" class="poi-item" @click="onPOIClick(poi)">
        <text class="poi-title">{{ poi.title }}</text>
        <text class="poi-address">{{ poi.address }}</text>
      </view>
      <view v-if="poiResults.length === 0" class="poi-empty">
        <text class="empty-text">未找到相关地点</text>
      </view>
    </scroll-view>

    <!-- 底部确认栏 -->
    <view class="bottom-bar">
      <view class="selected-info">
        <text class="label">已选位置</text>
        <text class="address">{{ selectedAddress || '请点击地图选择' }}</text>
      </view>
      <button
        class="confirm-btn"
        :class="{ disabled: !selectedAddress }"
        :disabled="!selectedAddress"
        @click="confirm"
      >
        确认选择
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { reverseGeocode, searchPOI } from '@/utils/map';
import type { POIItem } from '@/utils/map';

interface MapMarker {
  id: number;
  latitude: number;
  longitude: number;
  iconPath: string;
  width: number;
  height: number;
}

interface MapTapEvent {
  detail: { latitude: number; longitude: number };
}

interface PrevPageVM {
  $vm?: { selectedLocation?: { lat: number; lng: number; address: string } };
  selectedLocation?: { lat: number; lng: number; address: string };
}

const lat = ref(39.9042);
const lng = ref(116.4074);
const selectedAddress = ref('');
const keyword = ref('');
const markers = ref<MapMarker[]>([]);
const poiResults = ref<POIItem[]>([]);
const showPOIList = ref(false);

async function onSearch(): Promise<void> {
  if (!keyword.value.trim()) return;

  try {
    uni.showLoading({ title: '搜索中...' });
    const results = await searchPOI(keyword.value, lat.value, lng.value);
    poiResults.value = results;
    showPOIList.value = true;
    uni.hideLoading();
  } catch {
    uni.hideLoading();
    uni.showToast({ title: '搜索失败', icon: 'none' });
  }
}

function onPOIClick(poi: POIItem): void {
  lat.value = poi.location.lat;
  lng.value = poi.location.lng;
  selectedAddress.value = poi.title || poi.address;
  markers.value = [{
    id: Date.now(),
    latitude: poi.location.lat,
    longitude: poi.location.lng,
    iconPath: '/static/marker.png',
    width: 32,
    height: 32,
  }];
  showPOIList.value = false;
}

onMounted(() => {
  // 获取当前位置
  uni.getLocation({
    type: 'gcj02',
    success: (res: UniApp.GetLocationSuccess) => {
      lat.value = res.latitude;
      lng.value = res.longitude;
      reverseGeocode(res.latitude, res.longitude)
        .then((addr) => {
          selectedAddress.value = addr.address;
        })
        .catch(() => {
          // 逆地址解析失败，使用默认地址
        });
    },
    fail: () => {
      uni.showToast({ title: '获取位置失败', icon: 'none' });
    },
  });
});

function onMapTap(e: MapTapEvent): void {
  const { latitude, longitude } = e.detail;
  lat.value = latitude;
  lng.value = longitude;
  markers.value = [{
    id: 1,
    latitude,
    longitude,
    iconPath: '/static/marker.png',
    width: 32,
    height: 32,
  }];

  reverseGeocode(latitude, longitude)
    .then((addr) => {
      selectedAddress.value = addr.address;
    })
    .catch(() => {
      selectedAddress.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    });
}

function confirm(): void {
  if (!selectedAddress.value) return;

  // 返回上一页并传递选中的位置
  const pages = getCurrentPages();
  if (pages.length >= 2) {
    const prevPage = pages[pages.length - 2] as PrevPageVM | undefined;
    if (prevPage && prevPage.$vm) {
      prevPage.$vm.selectedLocation = {
        lat: lat.value,
        lng: lng.value,
        address: selectedAddress.value,
      };
    }
  }

  uni.navigateBack();
}
</script>

<style lang="scss" scoped>
.map-picker {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.search-bar {
  position: absolute;
  top: 24rpx;
  left: 24rpx;
  right: 24rpx;
  z-index: 10;
  background-color: #fff;
  border-radius: 40rpx;
  padding: 0 32rpx;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.1);
}

.search-input {
  height: 80rpx;
  font-size: 30rpx;
}

.placeholder {
  color: #ccc;
}

.map {
  flex: 1;
  width: 100%;
}

.bottom-bar {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 24rpx;
  background-color: #fff;
  box-shadow: 0 -4rpx 12rpx rgba(0, 0, 0, 0.05);
}

.selected-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  overflow: hidden;
}

.label {
  font-size: 24rpx;
  color: #999;
}

.address {
  font-size: 28rpx;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.confirm-btn {
  padding: 20rpx 48rpx;
  background-color: #4caf50;
  border-radius: 40rpx;
  border: none;
  color: #fff;
  font-size: 30rpx;
  font-weight: 500;
  margin: 0;
  line-height: 1.5;

  &::after {
    border: none;
  }

  &.disabled {
    background-color: #ccc;
  }
}

// POI 搜索结果列表
.poi-list {
  position: absolute;
  top: 120rpx;
  left: 24rpx;
  right: 24rpx;
  max-height: 60vh;
  background-color: #fff;
  border-radius: 16rpx;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.15);
  z-index: 20;
  overflow: hidden;
}

.poi-item {
  padding: 24rpx;
  border-bottom: 1rpx solid #f0f0f0;

  &:last-child {
    border-bottom: none;
  }

  &:active {
    background-color: #f5f5f5;
  }
}

.poi-title {
  display: block;
  font-size: 28rpx;
  font-weight: 500;
  color: #333;
  margin-bottom: 8rpx;
}

.poi-address {
  display: block;
  font-size: 24rpx;
  color: #999;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.poi-empty {
  display: flex;
  justify-content: center;
  padding: 60rpx 0;
}
</style>
