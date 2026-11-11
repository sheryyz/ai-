import { z } from 'zod'

// Chinese messages for all Zod issues (user-facing and fed back to the model for repair).
z.config(z.locales.zhCN())

export { z }
