import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { permissionApi } from '@/api/admin';
import type { StaffPermissionCode } from '@/types';

const FULL_ACCESS_ROLES = ['BOSS', 'SUPER_ADMIN', 'ADMIN'];

export const usePermissionStore = defineStore('permission', () => {
  const role = ref<string>('');
  const permissions = ref<StaffPermissionCode[]>([]);
  const loaded = ref(false);

  const isFullAccess = computed(() => FULL_ACCESS_ROLES.includes(role.value));
  const isStaff = computed(() => role.value === 'STAFF');
  const isBoss = computed(() => role.value === 'BOSS' || role.value === 'SUPER_ADMIN');

  function can(permission: StaffPermissionCode): boolean {
    if (isFullAccess.value) return true;
    return permissions.value.includes(permission);
  }

  const canManageProfitSharing = computed(() => can('PROFIT_SHARING_MANAGE'));
  const canManageOrderPrice = computed(() => can('ORDER_PRICE_MANAGE'));
  const canManageTaskCategory = computed(() => can('TASK_CATEGORY_MANAGE'));

  /** 是否有任何管理入口可见（老板或拥有任一权限的工作人员） */
  const hasAnyAdminEntry = computed(
    () => isFullAccess.value || permissions.value.length > 0,
  );

  async function load(): Promise<void> {
    try {
      const mine = await permissionApi.getMine();
      role.value = mine.role;
      permissions.value = mine.permissions;
      loaded.value = true;
    } catch {
      role.value = '';
      permissions.value = [];
      loaded.value = false;
    }
  }

  function clear(): void {
    role.value = '';
    permissions.value = [];
    loaded.value = false;
  }

  return {
    role,
    permissions,
    loaded,
    isFullAccess,
    isStaff,
    isBoss,
    can,
    canManageProfitSharing,
    canManageOrderPrice,
    canManageTaskCategory,
    hasAnyAdminEntry,
    load,
    clear,
  };
});
