import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'loaders-skeleton-shimmer',
  title: 'Skeleton Shimmer',
  category: 'loaders',
  tags: ['skeleton', 'shimmer', 'placeholder', 'content'],
}

const css = `
.awk-el-loaders-skeleton-shimmer {
  display: inline-flex;
  padding: 1rem;
  font-family: var(--font-sans, system-ui, sans-serif);
}

.awk-el-loaders-skeleton-shimmer .card {
  position: relative;
  width: 268px;
  padding: 14px;
  overflow: hidden;
  border-radius: var(--radius-lg, 12px);
  border: 1px solid var(--border-subtle, oklch(0.42 0.02 250));
  background: color-mix(in oklab, var(--bg-elevated, #1A2A40) 46%, transparent);
}

.awk-el-loaders-skeleton-shimmer .head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.awk-el-loaders-skeleton-shimmer .avatar {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 50%;
  background: color-mix(in oklab, var(--text-muted, oklch(0.74 0.02 250)) 26%, transparent);
}

.awk-el-loaders-skeleton-shimmer .head-lines {
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex: 1;
}

.awk-el-loaders-skeleton-shimmer .line {
  height: 8px;
  border-radius: 4px;
  background: color-mix(in oklab, var(--text-muted, oklch(0.74 0.02 250)) 24%, transparent);
}

.awk-el-loaders-skeleton-shimmer .w-70 { width: 70%; }
.awk-el-loaders-skeleton-shimmer .w-42 { width: 42%; }
.awk-el-loaders-skeleton-shimmer .w-92 { width: 92%; }
.awk-el-loaders-skeleton-shimmer .w-64 { width: 64%; }

.awk-el-loaders-skeleton-shimmer .body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.awk-el-loaders-skeleton-shimmer .media {
  display: block;
  height: 58px;
  border-radius: 8px;
  background: color-mix(in oklab, var(--text-muted, oklch(0.74 0.02 250)) 20%, transparent);
}

.awk-el-loaders-skeleton-shimmer .sheen {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    105deg,
    transparent 30%,
    color-mix(in oklab, var(--text-primary, #E8F0F8) 14%, transparent) 48%,
    transparent 66%
  );
  transform: translateX(-120%);
  animation: awk-el-loaders-skeleton-shimmer-1 1.7s ease-in-out infinite;
}

@keyframes awk-el-loaders-skeleton-shimmer-1 {
  0% { transform: translateX(-120%); }
  60%, 100% { transform: translateX(120%); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-loaders-skeleton-shimmer .sheen {
    animation: none;
    transform: none;
    opacity: 0.35;
  }
}
`

export default function SkeletonShimmer(): JSX.Element {
  return (
    <div className="awk-el-loaders-skeleton-shimmer">
      <style>{css}</style>
      <div className="card" role="status" aria-busy="true" aria-label="Loading content">
        <span className="sheen" aria-hidden="true" />
        <div className="head" aria-hidden="true">
          <span className="avatar" />
          <div className="head-lines">
            <span className="line w-70" />
            <span className="line w-42" />
          </div>
        </div>
        <div className="body" aria-hidden="true">
          <span className="line w-92" />
          <span className="line w-64" />
        </div>
        <span className="media" aria-hidden="true" />
      </div>
    </div>
  )
}
