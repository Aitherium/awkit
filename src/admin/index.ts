export { default as AdminShell } from './AdminShell'
export type { AdminShellProps, AdminNavItem } from './AdminShell'

export { default as AdminDashboard } from './AdminDashboard'
export type { AdminDashboardProps } from './AdminDashboard'

export { default as ProductManager } from './ProductManager'
export type { ProductManagerProps } from './ProductManager'

export { default as OrderManager } from './OrderManager'
export type { OrderManagerProps } from './OrderManager'

export { default as CustomerManager } from './CustomerManager'
export type { CustomerManagerProps } from './CustomerManager'

export { default as ReportsView } from './ReportsView'
export type { ReportsViewProps } from './ReportsView'

export { default as ContentManager } from './ContentManager'
export type { ContentManagerProps } from './ContentManager'

export { default as SettingsManager } from './SettingsManager'
export type { SettingsManagerProps } from './SettingsManager'

export {
  adminFetch,
  normalizeProduct,
  getToken,
  setToken,
  clearToken,
  getStoredUser,
  setStoredUser,
  clearStoredUser,
} from './AdminAPI'

export type {
  Product,
  ProductCreate,
  Order,
  Customer,
  CustomerCreate,
  DashboardStats,
  BlogPost,
  BlogPostCreate,
  SalesSummary,
  LowStockReport,
} from './AdminAPI'
