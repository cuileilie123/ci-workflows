import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/login', component: () => import('../views/Login.vue') },
  {
    path: '/',
    component: () => import('../layouts/AdminLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', component: () => import('../views/Dashboard.vue') },
      { path: 'users', component: () => import('../views/Users.vue') },
      { path: 'orders', component: () => import('../views/Orders.vue') },
      { path: 'moderation', component: () => import('../views/Moderation.vue') },
      { path: 'tickets', component: () => import('../views/Tickets.vue') },
      { path: 'promotions', component: () => import('../views/Promotions.vue') },
      { path: 'finance-settings', component: () => import('../views/FinanceSettings.vue') },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
