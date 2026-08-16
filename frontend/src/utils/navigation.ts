// 导航工具

export function openNavigation(lat: number, lng: number, name: string): void {
  uni.openLocation({
    latitude: lat,
    longitude: lng,
    name: name,
    scale: 18,
    success: () => console.log('[Navigation] 导航已打开'),
    fail: () => {
      // 降级：复制地址到剪贴板
      uni.setClipboardData({
        data: `${lat},${lng}`,
        success: () => {
          uni.showToast({ title: '坐标已复制', icon: 'success' });
        },
      });
    },
  });
}
