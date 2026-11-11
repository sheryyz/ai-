import { Link } from 'react-router'
import { EmptyState } from '../components/ui/feedback'

export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24">
      <EmptyState
        title="页面不存在"
        hint="链接可能已失效。"
        action={
          <Link to="/" className="text-sm font-medium underline-offset-4 hover:underline">
            返回应用中心
          </Link>
        }
      />
    </main>
  )
}
