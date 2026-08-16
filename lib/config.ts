/** 用户显示名称 — 服务端用 */
export const USER_DISPLAY_NAME = process.env.USER_DISPLAY_NAME || '用户'

/** 用户显示名称 — 客户端用（需要 NEXT_PUBLIC_ 前缀） */
export const USER_DISPLAY_NAME_CLIENT = process.env.NEXT_PUBLIC_USER_DISPLAY_NAME || '用户'
