import { ArrowLeft, CircleAlert } from 'lucide-react';
import { Link } from 'wouter';
import { BrandLogo } from '@/components/brand-logo';

export default function NotFound() {
  return <main className="flex min-h-[100dvh] items-center justify-center bg-background px-5 text-foreground">
    <div className="max-w-md text-center">
      <BrandLogo className="mx-auto h-16 w-36" />
      <CircleAlert className="mx-auto mt-10 text-primary" size={30} />
      <p className="eyebrow mt-5 text-primary">Page not found</p>
      <h1 className="serif mt-3 text-4xl font-semibold">That page took a different route.</h1>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">The link may be old, or the piece may have moved on. There is plenty more to see.</p>
      <Link href="/" className="mt-7 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground" data-testid="link-not-found-home"><ArrowLeft size={16} /> Back home</Link>
    </div>
  </main>;
}