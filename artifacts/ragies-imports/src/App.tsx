import { useEffect, useMemo, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, Route, Switch, useLocation, useParams, useSearch, Router as WouterRouter } from 'wouter';
import { ClerkProvider, SignIn, SignUp, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, BadgeCheck, BarChart3, CalendarDays, Check, ChevronLeft, CircleAlert, Clock3, Download, Filter, LayoutGrid,
  LogOut, MapPin, Menu, Minus, Package, Phone, Plus, Printer, RefreshCw, RotateCcw, Search, Send, ShoppingBag,
  SlidersHorizontal, Sparkles, Store, Trash2, TrendingDown, TrendingUp, Truck, UserRound, X, XCircle, Eye, EyeOff, MessageCircle, Users, Warehouse, ShieldCheck, Database, Pencil,
} from 'lucide-react';
import {
  getGetAdminDashboardQueryKey, getGetAdminEtaRemindersQueryKey, getGetProductQueryKey, getListAdminOrdersQueryKey, getListDeletedAdminOrdersQueryKey,
  getListCategoriesQueryKey, getListProductsQueryKey, getListShipmentsQueryKey, getListPromotionsQueryKey, getListAdminPromotionsQueryKey,
  getListAdminInventoryQueryKey, getListCustomersQueryKey, useListAdminInventory, useUpdateInventory, useListCustomers,
  getListMyOrdersQueryKey, getTrackOrderQueryKey, useCreateAdminOrder, useCreateOrder, useCreateProduct,
  useArchiveProduct, useCreateShipment, useDeleteAdminOrder, useDeleteShipment, useGetAdminDashboard, useGetProduct, useListAdminOrders, useListCategories,
  useListDeletedAdminOrders, useListMyOrders, useListProducts, useListShipments, useRestoreAdminOrder,
  useTrackOrder, useUpdateAdminOrder, useUpdateProduct, useUpdateShipment, useListPromotions, usePreviewPromotion, useListAdminPromotions, useCreatePromotion, useUpdatePromotion, useDeletePromotion,
  getGetAdminAccessQueryKey, getListStaffQueryKey, getGetDataProtectionSummaryQueryKey, useGetAdminAccess, useListStaff, useCreateStaff, useUpdateStaff, useGetDataProtectionSummary, exportDataSnapshot,
  getGetSiteContentQueryKey, useGetSiteContent, useUpdateSiteContent,
  usePrepareOrderPayment, getGetExchangeRateQueryKey, useGetExchangeRate, useUpdateExchangeRate,
  useInitializeCheckoutPayment,
  useListProductBatches, getListProductBatchesQueryKey,
} from '@workspace/api-client-react';
import type {
  AdminOrderInput, Category, Customer, DashboardSummary, Order, OrderInput, OrderUpdate, PaymentPreparation, Product, Shipment, Promotion, PromotionInput, StaffMember, StaffPermission, StaffInput, SiteContent,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { BrandLogo } from '@/components/brand-logo';
import { InheritedClosingField } from '@/components/inherited-closing-field';
import { AvailabilityBatchControl } from '@/components/availability-batch-control';
import { LaunchReset } from '@/components/launch-reset';
import { ProductDeleteButton } from '@/components/product-delete-button';
import { OrderStatisticsReset } from '@/components/order-statistics-reset';
import { StaffList } from '@/components/staff-list';
import { SmsNotificationsPanel } from '@/components/sms-notifications-panel';
import { StaffEtaAlerts } from '@/components/staff-eta-alerts';
import { InheritedEtaField } from '@/components/inherited-eta-field';
import { PhoneInput } from '@/components/phone-input';
import { OrderProgress } from '@/components/order-progress';
import { OrderPaymentSummary } from '@/components/order-payment-summary';
import { CartProvider, useCart } from '@/components/cart-provider';
import type { CartItem } from '@/lib/cart-session';
import { AccountProfile } from '@/components/account-profile';
import { useStorefrontSignOut } from '@/hooks/use-storefront-sign-out';
import { useAccountContactProfile } from '@/hooks/use-account-contact-profile';
import { useContactPhoneDefault } from '@/hooks/use-contact-phone-default';
import { categoryFromSearch, retainAvailableCategory, shopLocationWithCategory } from '@/lib/category-filter';
import {
  moveFeaturedCategory, resolveFeaturedCategories, toggleFeaturedCategory,
} from '@/lib/featured-categories';
import { markPaystackReturnPending } from '@/lib/paystack-return';
import { PaystackReturnRefresh } from '@/components/paystack-return-refresh';
import { isMissingAccountSessionError } from '@/lib/missing-account-session';
import { paymentProgress } from '@/lib/payment-progress';
import { money } from '@/lib/money';
import { date, shortDate } from '@/lib/dates';
import { normalizeContactPhone, orderContactLinks } from '@/lib/phone-numbers';
import { orderEditorPatch } from '@/lib/order-editor';
import { shipmentEditorPatch } from '@/lib/shipment-editor';
import { ProductOptionsFields } from '@/components/product-options-fields';
import { buildOptionsPayload, isQuantified, lineSelection, optionsFromProduct, productEditorPatch, procurementBreakdown, countsForProcurement, sizeStock, variantStock, type OptionsState } from '@/lib/product-options';
import { orderFreshness, refreshOrderViews } from '@/lib/order-sync';
import NotFound from '@/pages/not-found';
import './index.css';

const clerkPubKey = import.meta.env.VITE_CLERK_USE_CONFIGURED_KEY === 'true'
  ? import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
  : publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in the app environment.');
}

function stripBase(path: string) {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

type ApiErrorLike = { data?: unknown; message?: string; status?: number };
export function apiErrorMessage(error: unknown, fallback: string): string {
  const candidate = error as ApiErrorLike | null;
  const data = candidate?.data;
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') return (data as { error: string }).error;
  const message = candidate?.message;
  if (message) return message.replace(/^HTTP\s+\d{3}(?:\s+[^:]+)?:\s*/i, '').trim() || fallback;
  return fallback;
}

function DualCurrencyAmount({ amount, sourceCurrency = 'GHS', rate, className = '' }: { amount: number; sourceCurrency?: string; rate: number; className?: string }) {
  const isCny = sourceCurrency === 'CNY';
  const ghs = isCny ? amount / rate : amount;
  const cny = isCny ? amount : amount * rate;
  return <span className={`inline-flex flex-col ${className}`}><strong>{money(ghs, 'GHS')}</strong><small className="text-xs font-normal opacity-65">{money(cny, 'CNY')}</small></span>;
}

function Header() {
  const { items } = useCart();
  const { isSignedIn } = useAuth();
  const { signOut, isSigningOut, error: signOutError } = useStorefrontSignOut();
  const [menuOpen, setMenuOpen] = useState(false);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const access = useCurrentAdminAccess();
  const isAdmin = Boolean(isSignedIn && access.isSuccess && access.data?.active);
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-[4.6rem] max-w-7xl items-center justify-between px-5 lg:px-8">
        <Link href="/" className="flex items-center gap-3" data-testid="link-home">
          <BrandLogo className="h-16 w-[6.5rem]" />
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-semibold md:flex" aria-label="Main navigation">
          <Link href="/shop" className="transition-colors hover:text-primary" data-testid="link-shop">Shop</Link>
           <Link href="/promotions" className="transition-colors hover:text-primary" data-testid="link-promotions">Offers</Link>
          <Link href="/about" className="transition-colors hover:text-primary" data-testid="link-about">Our story</Link>
          <Link href="/track-order" className="transition-colors hover:text-primary" data-testid="link-track-order">Track order</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href={isSignedIn ? "/account" : "/sign-in"} className="hidden h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold sm:flex" data-testid="link-account">
            <UserRound size={16} /> {isSignedIn ? "Account" : "Sign in"}
          </Link>
          {isAdmin && <Link href="/admin" className="hidden h-10 items-center rounded-full border border-border px-4 text-sm font-semibold sm:flex" data-testid="link-admin">Admin</Link>}
          {isSignedIn && <button disabled={isSigningOut} onClick={() => void signOut()} className="hidden h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold disabled:opacity-50 sm:flex" data-testid="button-sign-out"><LogOut size={16} /> {isSigningOut ? 'Signing out…' : 'Log out'}</button>}
          <Link href="/checkout" className="relative flex h-10 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-semibold text-secondary-foreground transition-transform hover:-translate-y-0.5" data-testid="link-cart">
            <ShoppingBag size={17} /><span className="hidden sm:inline">Bag</span>
            {count > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-accent-foreground" data-testid="text-cart-count">{count}</span>}
          </Link>
          <button className="flex h-10 w-10 items-center justify-center rounded-full border border-border md:hidden" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation" data-testid="button-toggle-menu">
            {menuOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>
      {signOutError && <p role="alert" className="border-t border-border px-5 py-3 text-sm text-destructive">{signOutError}</p>}
      {menuOpen && <nav className="border-t border-border px-5 py-4 md:hidden" aria-label="Mobile navigation">
        <div className="flex flex-col gap-4 text-sm font-semibold">
          <Link onClick={() => setMenuOpen(false)} href="/shop" data-testid="link-mobile-shop">Shop</Link>
           <Link onClick={() => setMenuOpen(false)} href="/promotions" data-testid="link-mobile-promotions">Offers</Link>
          <Link onClick={() => setMenuOpen(false)} href="/about" data-testid="link-mobile-about">Our story</Link>
          <Link onClick={() => setMenuOpen(false)} href="/track-order" data-testid="link-mobile-track">Track my order</Link>
          <Link onClick={() => setMenuOpen(false)} href={isSignedIn ? "/account" : "/sign-in"} data-testid="link-mobile-account">{isSignedIn ? "My account" : "Sign in"}</Link>
          {isAdmin && <Link onClick={() => setMenuOpen(false)} href="/admin" data-testid="link-mobile-admin">Admin</Link>}
          {isSignedIn && <button disabled={isSigningOut} onClick={() => void signOut()} className="flex items-center gap-2 text-left disabled:opacity-50" data-testid="button-mobile-sign-out"><LogOut size={16} /> {isSigningOut ? 'Signing out…' : 'Log out'}</button>}
        </div>
      </nav>}
    </header>
  );
}

function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`min-h-[100dvh] bg-background text-foreground ${className}`}><Header />{children}<Footer /></div>;
}
function Footer() {
  const content = useGetSiteContent({ query: { queryKey: getGetSiteContentQueryKey() } });
  const site = content.data;
  return <footer className="mt-20 bg-secondary px-5 py-12 text-secondary-foreground lg:px-8">
    <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
      <div><BrandLogo framed className="h-[4.25rem] w-32" /><p className="mt-5 max-w-xs text-sm leading-6 text-secondary-foreground/70">Good things, sourced with a sharp eye. Discover imported pieces with a clear path from our hands to yours.</p></div>
      <div><p className="eyebrow text-accent">Navigate</p><div className="mt-4 flex flex-col gap-3 text-sm text-secondary-foreground/75"><Link href="/shop" data-testid="footer-link-shop">Shop all</Link><Link href="/about" data-testid="footer-link-about">Buying guide</Link><Link href="/track-order" data-testid="footer-link-track">Track an order</Link></div></div>
      <div><p className="eyebrow text-accent">Need a hand?</p><div className="mt-4 space-y-3 text-sm text-secondary-foreground/75"><p className="flex items-center gap-2"><Phone size={14} /> {site?.contactPhone ?? '+233 50 000 0000'}</p><p className="flex items-center gap-2"><MapPin size={14} /> {site?.contactLocation ?? 'Accra, Ghana'}</p><p className="flex items-center gap-2"><Clock3 size={14} /> {site?.businessHours ?? 'Mon–Sat, 9am–6pm'}</p></div></div>
    </div>
    <div className="mx-auto mt-12 max-w-7xl border-t border-secondary-foreground/15 pt-5 text-xs text-secondary-foreground/45">© {new Date().getFullYear()} Ragies Imports. Made for your next good outfit.</div>
  </footer>;
}

function ImageTile({ product, large = false }: { product: Product; large?: boolean }) {
  return <div className={`product-image relative overflow-hidden ${large ? 'h-[30rem] sm:h-[38rem]' : 'aspect-[4/5]'}`}>
    {product.images[0] ? <img src={product.images[0]} alt={product.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-end p-5 text-6xl font-semibold text-primary-foreground/90 serif">{product.name.charAt(0)}</div>}
  </div>;
}
function Availability({ availability }: { availability: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em] ${availability === 'ghana-stock' ? 'bg-accent text-accent-foreground' : 'bg-secondary text-secondary-foreground'}`} data-testid={`status-availability-${availability}`}>
    <span className="h-1.5 w-1.5 rounded-full bg-current" />{availability === 'ghana-stock' ? 'Ready in Ghana' : 'Pre-order'}
  </span>;
}
function ProductCard({ product }: { product: Product }) {
  return <Link href={`/product/${product.id}`} className="product-card group block" data-testid={`card-product-${product.id}`}>
    <div className="relative">
      <ImageTile product={product} />
      <div className="absolute left-3 top-3"><Availability availability={product.availability} /></div>
      <span className="absolute bottom-3 right-3 flex h-9 w-9 translate-y-2 items-center justify-center rounded-full bg-card/90 opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100"><ArrowUpRight size={17} /></span>
    </div>
    <div className="flex items-start justify-between gap-3 pt-4">
      <div><p className="eyebrow text-muted-foreground">{product.category}</p><h3 className="mt-1 font-semibold">{product.name}</h3><p className={`mt-1 text-sm ${product.preOrderClosed ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>{product.preOrderClosed ? 'Pre-order closed' : product.availability === 'pre-order' && product.eta ? `Arrives ${shortDate(product.eta)}` : `${product.stockQuantity} available`}</p></div>
      <div className="text-right"><p className="whitespace-nowrap text-sm font-bold">{money(product.price, product.currency)}</p>{product.compareAtPrice && product.compareAtPrice > product.price && <p className="whitespace-nowrap text-xs text-muted-foreground line-through">{money(product.compareAtPrice, product.currency)}</p>}</div>
    </div>
  </Link>;
}
function ProductSkeleton() {
  return <div><div className="skeleton aspect-[4/5] rounded-sm" /><div className="mt-4 h-3 w-20 rounded skeleton" /><div className="mt-2 h-5 w-3/4 rounded skeleton" /></div>;
}
function QueryError({ error, retry }: { error?: unknown; retry?: () => void }) {
  return <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center"><CircleAlert className="mx-auto text-destructive" /><h3 className="mt-3 font-semibold">We couldn't load that just now</h3><p className="mt-1 text-sm text-muted-foreground">{apiErrorMessage(error, 'Check your connection and try again.')}</p>{retry && <button onClick={retry} className="mt-5 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground" data-testid="button-retry"><RefreshCw size={15} /> Try again</button>}</div>;
}
function SectionHeading({ kicker, title, action }: { kicker: string; title: string; action?: ReactNode }) {
  return <div className="mb-8 flex items-end justify-between gap-4"><div><p className="eyebrow text-primary">{kicker}</p><h2 className="serif mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2></div>{action}</div>;
}

function Home() {
  const content = useGetSiteContent({ query: { queryKey: getGetSiteContentQueryKey() } });
  const site = content.data;
  const products = useListProducts({ sort: 'featured' }, { query: { ...orderFreshness, queryKey: getListProductsQueryKey({ sort: 'featured' }) } });
  const categories = useListCategories({ query: { ...orderFreshness, queryKey: getListCategoriesQueryKey() } });
  const featuredCategorySlugs = resolveFeaturedCategories(site?.featuredCategories, categories.data);
  const categoriesBySlug = new Map((categories.data ?? []).map((category) => [category.slug, category]));
  const featuredCategories = featuredCategorySlugs.flatMap((slug) => {
    const category = categoriesBySlug.get(slug);
    return category ? [category] : [];
  });
  const featured = (products.data ?? []).filter((product) => !product.hidden).slice(0, 4);
  return <Page>
    <main>
      <section className="paper-grid overflow-hidden px-5 pb-16 pt-12 lg:px-8 lg:pb-24 lg:pt-20">
        <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.02fr_.98fr]">
           <div className="reveal max-w-xl"><p className="eyebrow flex items-center gap-2 text-primary"><span className="h-px w-7 bg-primary" />{site?.heroEyebrow ?? 'Imported, considered, yours'}</p><h1 className="serif mt-6 text-6xl font-semibold leading-[.92] tracking-[-.045em] sm:text-8xl">{site?.heroTitle ?? 'Find the piece'}<br /><span className="text-primary">{site?.heroAccent ?? "you'll keep."}</span></h1><p className="mt-7 max-w-md text-base leading-7 text-muted-foreground">{site?.heroDescription ?? 'Ragies Imports brings the good stuff closer — expressive fashion and useful lifestyle finds, sourced beyond the obvious.'}</p><div className="mt-8 flex flex-wrap gap-3"><Link href="/shop" className="inline-flex items-center gap-3 rounded-full bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-1" data-testid="button-hero-shop">Shop <ArrowRight size={16} /></Link><Link href="/about" className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3.5 text-sm font-bold transition-colors hover:bg-card" data-testid="button-hero-story">How it works</Link></div></div>
          <div className="reveal-2 relative mx-auto w-full max-w-[28rem] lg:max-w-[25rem]">
            <div className="overflow-hidden rounded-2xl bg-secondary shadow-2xl">
              <img src="/images/home-boutique.png" alt="A warm boutique interior with clothing, handbags, and accessories" width={1024} height={1535} fetchPriority="high" decoding="async" className="block h-auto w-full" data-testid="image-home-hero" />
            </div>
            <div className="absolute -bottom-3 left-3 flex items-center gap-2 rounded-full bg-card px-4 py-3 text-xs font-bold shadow-lg"><BadgeCheck className="text-primary" size={17} /> Clear on timing, always</div>
          </div>
        </div>
      </section>
      <div className="marquee border-y border-border bg-primary py-3 text-primary-foreground"><div className="text-xs font-bold uppercase tracking-[.22em]">READY IN GHANA&nbsp;&nbsp;•&nbsp;&nbsp; PRE-ORDERS WITH A PLAN&nbsp;&nbsp;•&nbsp;&nbsp; PERSONAL SERVICE&nbsp;&nbsp;•&nbsp;&nbsp; READY IN GHANA&nbsp;&nbsp;•&nbsp;&nbsp; PRE-ORDERS WITH A PLAN&nbsp;&nbsp;•&nbsp;&nbsp;</div></div>
      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8"><SectionHeading kicker="Browse by mood" title="Start where your eye lands." action={<Link href="/shop" className="hidden items-center gap-2 text-sm font-bold text-primary sm:flex" data-testid="link-browse-all">See all pieces <ArrowRight size={15} /></Link>} /><div className="grid gap-3 sm:grid-cols-3">{featuredCategories.map((category: Category, index) => <Link href={shopLocationWithCategory('/shop', '', category.slug)} key={category.slug} className={`group relative flex min-h-40 items-end overflow-hidden p-5 ${index === 1 ? 'bg-primary text-primary-foreground' : index === 2 ? 'bg-accent' : 'bg-secondary text-secondary-foreground'}`} data-testid={`link-category-${category.slug}`}><div><p className="serif text-3xl">{category.name}</p><p className="mt-1 text-xs opacity-65">{category.count} pieces to browse</p></div><ArrowUpRight className="absolute right-5 top-5 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" size={20} /></Link>)}{categories.isLoading && [1,2,3].map((item) => <div key={item} className="skeleton min-h-40" />)}{!categories.isLoading && !featuredCategories.length && <Link href="/shop" className="col-span-3 flex min-h-40 items-end bg-secondary p-5 text-secondary-foreground" data-testid="link-category-shop"><div><p className="serif text-3xl">The full edit</p><p className="mt-1 text-xs opacity-65">Browse everything</p></div></Link>}</div></section>
      <section className="bg-card px-5 py-20 lg:px-8"><div className="mx-auto max-w-7xl"><SectionHeading kicker="The considered edit" title="Good pieces, no mystery." action={<Link href="/shop" className="hidden items-center gap-2 text-sm font-bold text-primary sm:flex" data-testid="link-featured-all">View all <ArrowRight size={15} /></Link>} />{products.isError ? <QueryError retry={() => products.refetch()} /> : <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4 md:gap-6">{products.isLoading ? [1,2,3,4].map((item) => <ProductSkeleton key={item} />) : featured.map((product) => <ProductCard key={product.id} product={product} />)}</div>}</div></section>
      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-20 lg:grid-cols-[.8fr_1.2fr] lg:px-8"><div><p className="eyebrow text-primary">The Ragies promise</p><h2 className="serif mt-3 text-4xl font-semibold leading-tight">You should always know what happens next.</h2></div><div className="grid gap-3 sm:grid-cols-3"><div className="border-t-2 border-primary pt-4"><p className="font-bold">01 / Clear status</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Every item says whether it is already in Ghana or on its way.</p></div><div className="border-t-2 border-primary pt-4"><p className="font-bold">02 / Real updates</p><p className="mt-2 text-sm leading-6 text-muted-foreground">We share the useful details before you need to ask.</p></div><div className="border-t-2 border-primary pt-4"><p className="font-bold">03 / Human help</p><p className="mt-2 text-sm leading-6 text-muted-foreground">A quick WhatsApp message is part of the service.</p></div></div></section>
    </main>
  </Page>;
}

function Shop() {
  const [search, setSearch] = useState('');
  const [location, setLocation] = useLocation();
  const locationSearch = useSearch();
  const requestedCategory = categoryFromSearch(locationSearch);
  const [availability, setAvailability] = useState<'all' | 'ghana-stock' | 'pre-order'>('all');
  const [sort, setSort] = useState<'featured' | 'newest' | 'price-low' | 'price-high'>('featured');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const categories = useListCategories({ query: { ...orderFreshness, queryKey: getListCategoriesQueryKey() } });
  const category = retainAvailableCategory(requestedCategory, categories.data);
  const setCategory = (slug: string, replace = false) => {
    if (slug === requestedCategory) return;
    setLocation(shopLocationWithCategory(location, locationSearch, slug), { replace });
  };
  const params = useMemo(() => ({ search: search || undefined, category: category || undefined, availability, sort }), [search, category, availability, sort]);
  const products = useListProducts(params, { query: { ...orderFreshness, queryKey: getListProductsQueryKey(params) } });
  useEffect(() => {
    if (categories.data && requestedCategory && !category) setCategory('', true);
  }, [categories.data, requestedCategory, category]);
  const shown = (products.data ?? []).filter((product) => !product.hidden);
  return <Page><main className="mx-auto max-w-7xl px-5 py-10 lg:px-8 lg:py-16">
    <div className="flex flex-col justify-between gap-5 border-b border-border pb-8 sm:flex-row sm:items-end"><div><p className="eyebrow text-primary">The shop</p><h1 className="serif mt-2 text-5xl font-semibold tracking-tight">Take your time.</h1><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">Pieces selected for a life with plans. Filter by what can move now and what is worth waiting for.</p></div><Link href="/track-order" className="inline-flex items-center gap-2 text-sm font-bold text-primary" data-testid="link-shop-track">Already ordered? Track it <ArrowRight size={15} /></Link></div>
    <div className="mt-8 flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search dresses, bags, home..." className="h-12 w-full rounded-xl border border-input bg-card pl-11 pr-4 text-sm outline-none transition-colors focus:border-primary" data-testid="input-search-products" /></label><button className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold sm:hidden" onClick={() => setFiltersOpen(!filtersOpen)} data-testid="button-toggle-filters"><SlidersHorizontal size={16} /> Filters</button><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="hidden h-12 rounded-xl border border-input bg-card px-4 text-sm font-semibold outline-none sm:block" aria-label="Sort products" data-testid="select-sort-products"><option value="featured">Featured first</option><option value="newest">Newest</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></div>
    <div className="mt-3 flex gap-2 overflow-x-auto pb-1"><button onClick={() => setAvailability(availability === 'ghana-stock' ? 'all' : 'ghana-stock')} className={`whitespace-nowrap rounded-full px-4 py-2.5 text-xs font-bold ${availability === 'ghana-stock' ? 'bg-accent' : 'border border-border bg-card'}`} data-testid="button-filter-ready">Ready in Ghana</button><button onClick={() => setAvailability(availability === 'pre-order' ? 'all' : 'pre-order')} className={`whitespace-nowrap rounded-full px-4 py-2.5 text-xs font-bold ${availability === 'pre-order' ? 'bg-secondary text-secondary-foreground' : 'border border-border bg-card'}`} data-testid="button-filter-preorder">Pre-order</button></div>
    <div className={`${filtersOpen ? 'flex' : 'hidden'} mt-3 flex-col gap-3 rounded-xl bg-card p-4 sm:flex sm:flex-row sm:items-center sm:bg-transparent sm:p-0`}><div className="flex gap-2 overflow-x-auto pb-1"><button onClick={() => setCategory('')} className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold ${!category ? 'bg-secondary text-secondary-foreground' : 'border border-border'}`} data-testid="button-filter-all">All pieces</button>{(categories.data ?? []).map((item) => <button key={item.slug} onClick={() => setCategory(item.slug)} className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold ${category === item.slug ? 'bg-secondary text-secondary-foreground' : 'border border-border'}`} data-testid={`button-filter-category-${item.slug}`}>{item.name}</button>)}</div></div>
    <div className="mt-10 flex items-center justify-between"><p className="text-sm text-muted-foreground" data-testid="text-product-count">{products.isLoading ? 'Finding pieces…' : `${shown.length} ${shown.length === 1 ? 'piece' : 'pieces'}`}</p><p className="hidden text-xs text-muted-foreground sm:block">Tap a piece for the full story</p></div>
    <div className="mt-5">{products.isError ? <QueryError retry={() => products.refetch()} /> : shown.length === 0 && !products.isLoading ? <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-20 text-center"><Sparkles className="mx-auto text-primary" /><h3 className="serif mt-4 text-2xl">Nothing in that corner yet.</h3><p className="mt-2 text-sm text-muted-foreground">Try another search or clear the filters.</p><button onClick={() => { setSearch(''); setCategory(''); setAvailability('all'); }} className="mt-5 rounded-full bg-secondary px-5 py-2.5 text-sm font-bold text-secondary-foreground" data-testid="button-clear-filters">Clear filters</button></div> : <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4">{products.isLoading ? [1,2,3,4,5,6,7,8].map((item) => <ProductSkeleton key={item} />) : shown.map((product) => <ProductCard key={product.id} product={product} />)}</div>}</div>
  </main></Page>;
}

function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const product = useGetProduct(productId, { query: { ...orderFreshness, queryKey: getGetProductQueryKey(productId), enabled: Number.isFinite(productId) } });
  const { addItem, items: cartItems } = useCart();
  const [, setLocation] = useLocation();
  const [variantType, setVariantType] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (!product.data) return;
    const current = product.data;
    const chosen = current.variants.find((entry) => entry.name === variantType) ?? current.variants[0];
    const quantified = isQuantified(current.variants);
    const colors = chosen?.colors ?? (current.variants.length ? [] : current.colors);
    setVariantType(chosen?.name ?? null);
    setColor((selected) => selected && colors.includes(selected) ? selected
      : quantified ? chosen?.quantities?.find((entry) => entry.quantity > 0)?.color ?? colors[0] ?? null
      : colors[0] ?? null);
    setSize((selected) => quantified ? chosen?.name ?? null
      : selected && current.sizes.includes(selected) ? selected : current.sizes[0] ?? null);
  }, [product.data, variantType]);
  if (product.isLoading) return <Page><main className="mx-auto grid max-w-7xl gap-8 px-5 py-12 md:grid-cols-2 lg:px-8"><div className="skeleton h-[38rem]" /><div className="space-y-5"><div className="skeleton h-4 w-20" /><div className="skeleton h-12 w-3/4" /><div className="skeleton h-28 w-full" /></div></main></Page>;
  if (product.isError || !product.data) return <Page><main className="mx-auto max-w-xl px-5 py-24"><QueryError retry={() => product.refetch()} /></main></Page>;
  const sourceItem = product.data;
  const optionColors = sourceItem.variants.find((entry) => entry.name === variantType)?.colors ?? (sourceItem.variants.length ? [] : sourceItem.colors);
  const quant = isQuantified(sourceItem.variants);
  const item = sourceItem.variants.length && !quant ? { ...sourceItem, colors: optionColors } : sourceItem;
  const shownColors = quant ? optionColors : item.colors;
  const stock = quant ? variantStock(sourceItem, variantType, color) : null;
  const inBag = cartItems.find((entry) => entry.product.id === sourceItem.id && entry.color === (color ?? null) && entry.variantType === variantType && entry.size === (quant ? variantType : size))?.quantity ?? 0;
  const remaining = stock === null ? null : sourceItem.availability === 'ghana-stock' ? stock : Math.max(0, stock - inBag);
  const soldOut = quant && (stock ?? 0) <= 0;
  const add = () => { if (item.preOrderClosed || (item.variants.length > 0 && !variantType) || (stock !== null && stock <= inBag)) return; const chosenVariant = item.variants.find((entry) => entry.name === variantType); addItem(sourceItem, { color: color ?? chosenVariant?.colors[0] ?? null, size: quant ? variantType : size, variantType }); setAdded(true); };
  return <Page><main className="mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-14"><Link href="/shop" className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground" data-testid="link-back-shop"><ChevronLeft size={16} /> Back to shop</Link><div className="grid gap-10 md:grid-cols-[1.05fr_.95fr] md:gap-16"><div><ImageTile product={item} large /><div className="mt-3 grid grid-cols-3 gap-3">{item.images.slice(0, 3).map((image, index) => <img key={image} src={image} alt={`${item.name} view ${index + 1}`} className="aspect-square object-cover" />)}</div></div><div className="md:pt-5"><Availability availability={item.availability} /><p className="eyebrow mt-7 text-muted-foreground">{item.category}</p><h1 className="serif mt-2 text-5xl font-semibold leading-[.95] tracking-tight">{item.name}</h1><div className="mt-5 flex items-center gap-3"><p className="text-2xl font-bold">{money(item.price, item.currency)}</p>{item.compareAtPrice && <p className="text-sm text-muted-foreground line-through">{money(item.compareAtPrice, item.currency)}</p>}</div><p className="mt-6 max-w-lg leading-7 text-muted-foreground">{item.description}</p><div className="mt-8 border-y border-border py-5">{item.availability === 'pre-order' ? <p className={`flex items-start gap-3 text-sm ${item.preOrderClosed ? 'text-destructive' : ''}`}><Clock3 className="mt-0.5 shrink-0 text-primary" size={17} /><span><strong>{item.preOrderClosed ? 'This pre-order is closed.' : 'Made to order, on a clear timeline.'}</strong><br /><span className={item.preOrderClosed ? '' : 'text-muted-foreground'}>Orders close {date(item.preOrderCloseDate)} · expected {date(item.eta)}.</span></span></p> : <p className="flex items-start gap-3 text-sm"><BadgeCheck className="mt-0.5 shrink-0 text-primary" size={17} /><span><strong>Ready in Ghana.</strong><br /><span className="text-muted-foreground">{item.stockQuantity} available to dispatch.</span></span></p>}</div>{item.variants.length > 0 && <div className="mt-7"><p className="text-sm font-bold">{quant ? 'Size' : 'Type'} <span className="font-normal text-muted-foreground">{variantType ?? 'Choose one'}</span></p><div className="mt-3 flex flex-wrap gap-2">{item.variants.map((variant) => <button type="button" key={variant.name} onClick={() => { setVariantType(variant.name); if (quant) setSize(variant.name); setColor((quant ? variant.quantities?.find((entry) => entry.quantity > 0)?.color : undefined) ?? variant.colors[0] ?? null); setAdded(false); }} className={`rounded-full border px-4 py-2 text-xs font-semibold ${quant && sizeStock(variant) <= 0 ? 'opacity-50 line-through ' : ''}${variantType === variant.name ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`} data-testid={`button-type-${variant.name}`}>{variant.name}</button>)}</div></div>}{shownColors.length > 0 && <div className="mt-7"><p className="text-sm font-bold">Colour <span className="font-normal text-muted-foreground">{color}</span></p><div className="mt-3 flex flex-wrap gap-2">{shownColors.map((option) => <button type="button" key={option} onClick={() => { setColor(option); setAdded(false); }} className={`rounded-full border px-4 py-2 text-xs font-semibold ${quant && (variantStock(sourceItem, variantType, option) ?? 0) <= 0 ? 'opacity-50 line-through ' : ''}${color === option ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`} data-testid={`button-color-${option}`}>{option}</button>)}</div></div>}{!quant && item.sizes.length > 0 && <div className="mt-6"><p className="text-sm font-bold">Size <span className="font-normal text-muted-foreground">{size}</span></p><div className="mt-3 flex flex-wrap gap-2">{item.sizes.map((option) => <button type="button" key={option} onClick={() => setSize(option)} className={`flex h-10 min-w-10 items-center justify-center rounded-full border px-3 text-xs font-semibold ${size === option ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`} data-testid={`button-size-${option}`}>{option}</button>)}</div></div>}{quant && remaining !== null && <p className={`mt-6 text-sm font-semibold ${remaining <= 0 ? 'text-destructive' : ''}`} data-testid="text-combination-remaining">{soldOut ? 'Sold out in this size and colour.' : remaining <= 0 ? 'All remaining pieces in this size and colour are already in your bag.' : `${remaining} remaining in ${variantType}${color ? `, ${color}` : ''}`}</p>}<div className="mt-9 flex gap-3"><button onClick={add} disabled={item.preOrderClosed || (item.variants.length > 0 && !variantType) || (remaining !== null && remaining <= 0)} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0" data-testid="button-add-to-bag">{item.preOrderClosed ? 'Pre-order closed' : item.variants.length > 0 && !variantType ? (quant ? 'Choose a size' : 'Choose a type') : soldOut ? 'Sold out' : remaining !== null && remaining <= 0 ? 'Maximum in bag' : added ? <><Check size={17} /> Added to bag</> : <><ShoppingBag size={17} /> Add to bag</>}</button>{added && <button onClick={() => setLocation('/checkout')} className="rounded-full bg-secondary px-5 py-4 text-sm font-bold text-secondary-foreground" data-testid="button-go-checkout">Checkout</button>}</div><div className="mt-7 grid grid-cols-2 gap-3 text-xs text-muted-foreground"><p className="flex gap-2"><Truck size={15} className="text-primary" /> Delivery across Ghana</p><p className="flex gap-2"><Send size={15} className="text-primary" /> WhatsApp support</p></div></div></div></main></Page>;
}

function Checkout() {
  const { items: cartItems, setQuantity, removeItem } = useCart();
  const contactProfile = useAccountContactProfile();
  const catalog = useListProducts(undefined, {
    query: {
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: 'always',
      refetchOnReconnect: 'always',
      queryKey: getListProductsQueryKey(),
    },
    request: { cache: 'no-store' },
  });
  const refreshCheckoutCatalog = catalog.refetch;
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void refreshCheckoutCatalog();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [refreshCheckoutCatalog]);
  const items = useMemo(() => cartItems.map((item) => ({
    ...item, product: catalog.data?.find((product) => product.id === item.product.id) ?? item.product,
  })), [cartItems, catalog.data]);
  const createOrder = useCreateOrder();
  const initializePayment = useInitializeCheckoutPayment();
  const [form, setForm] = useState({ customerName: '', email: '', phone: '', whatsapp: '', address: '', city: 'Accra', fulfillmentMethod: 'delivery' as OrderInput['fulfillmentMethod'], notes: '', paymentMethod: 'paystack' as OrderInput['paymentMethod'], paymentChannel: 'mobile_money' as 'mobile_money' | 'card' | 'bank_transfer' });
  const contactOwnerRef = useRef<string | null>(null);
  const contactEditedRef = useRef({ phone: false, whatsapp: false });
  useEffect(() => {
    if (contactOwnerRef.current === contactProfile.ownerId) return;
    const previousOwner = contactOwnerRef.current;
    contactOwnerRef.current = contactProfile.ownerId;
    if (previousOwner === null && contactProfile.ownerId !== null) return;
    contactEditedRef.current = { phone: false, whatsapp: false };
    setForm((current) => ({ ...current, phone: '', whatsapp: '' }));
  }, [contactProfile.ownerId]);
  useEffect(() => {
    if (!contactProfile.ownerId || contactOwnerRef.current !== contactProfile.ownerId || !contactProfile.profile.data) return;
    const storedPhone = contactProfile.profile.data.phone ?? '';
    setForm((current) => ({
      ...current,
      phone: contactEditedRef.current.phone ? current.phone : storedPhone,
      whatsapp: contactEditedRef.current.whatsapp ? current.whatsapp : storedPhone,
    }));
  }, [contactProfile.ownerId, contactProfile.profile.data]);
  const [error, setError] = useState('');
  const ghanaItems = items.filter((item) => item.product.availability === 'ghana-stock');
  const preorderItems = items.filter((item) => item.product.availability === 'pre-order');
  const ghanaTotal = ghanaItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const preorderGroups = useMemo(() => {
    const groups = new Map<string, { shipmentId: number | null; items: CartItem[]; total: number }>();
    preorderItems.forEach((item) => {
      const shipmentId = item.product.shipmentId ?? null;
      const key = shipmentId == null ? 'legacy' : String(shipmentId);
      const group = groups.get(key) ?? { shipmentId, items: [], total: 0 };
      group.items.push(item);
      group.total += item.product.price * item.quantity;
      groups.set(key, group);
    });
    return Array.from(groups, ([key, group]) => ({ key, ...group }));
  }, [items]);
  const [preorderPayments, setPreorderPayments] = useState<Record<string, string>>({});
  const previousTotals = useRef<Record<string, number>>({});
  useEffect(() => setPreorderPayments((current) => {
    const next = { ...current };
    preorderGroups.forEach((group) => {
      if (next[group.key] == null || previousTotals.current[group.key] !== group.total) next[group.key] = group.total.toFixed(2);
      previousTotals.current[group.key] = group.total;
    });
    return next;
  }), [preorderGroups]);
  const update = (key: keyof typeof form, value: string) => {
    if (key === 'phone') contactEditedRef.current.phone = true;
    if (key === 'whatsapp') contactEditedRef.current.whatsapp = true;
    setForm((current) => key === 'city' && (value === '__pickup__' || value === '__delivery__')
      ? { ...current, fulfillmentMethod: value === '__pickup__' ? 'pickup' : 'delivery', city: value === '__pickup__' ? '' : 'Accra', address: value === '__pickup__' ? '' : current.address }
      : { ...current, [key]: value });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const group = submitter?.dataset.group ?? '';
    const preorderGroup = preorderGroups.find((entry) => `pre-order:${entry.key}` === group);
    const checkoutItems = group === 'ghana-stock' ? ghanaItems : preorderGroup?.items ?? [];
    if (!checkoutItems.length) return;
    setError('');
    const groupTotal = group === 'ghana-stock' ? ghanaTotal : preorderGroup?.total ?? 0;
    const minimum = group === 'ghana-stock' ? ghanaTotal : Number(((groupTotal * 0.8)).toFixed(2));
    const paymentAmount = group === 'ghana-stock' ? ghanaTotal : Number(preorderPayments[preorderGroup?.key ?? '']);
    if (!Number.isFinite(paymentAmount) || paymentAmount < minimum || paymentAmount > groupTotal) {
      setError(group === 'ghana-stock'
        ? 'Ready-in-Ghana orders require full payment.'
        : `Enter a pre-order payment between ${money(minimum)} and ${money(groupTotal)} for this batch.`);
      return;
    }
    const orderItems = checkoutItems.map((item) => ({ productId: item.product.id, quantity: item.quantity, color: item.color, size: item.size, variantType: item.variantType }));
    const { email, paymentChannel, ...orderForm } = form;
    const contactPhone = normalizeContactPhone(form.phone) ?? form.phone.trim();
    const contactWhatsapp = form.whatsapp.trim() ? normalizeContactPhone(form.whatsapp) ?? form.whatsapp.trim() : null;
    createOrder.mutate({ data: { ...orderForm, phone: contactPhone, address: form.fulfillmentMethod === 'pickup' ? '' : form.address, city: form.fulfillmentMethod === 'pickup' ? null : form.city, whatsapp: contactWhatsapp, notes: form.notes || null, items: orderItems } }, {
      onSuccess: (order) => {
        initializePayment.mutate({ id: order.id, data: { orderNumber: order.orderNumber, email, amount: paymentAmount, channel: paymentChannel } }, {
          onSuccess: (payment) => {
            sessionStorage.setItem(`ragies-pending-checkout-${order.orderNumber}`, JSON.stringify({
              phone: contactPhone,
              items: checkoutItems.map((item) => ({
                productId: item.product.id,
                quantity: item.quantity,
                color: item.color,
                size: item.size,
                variantType: item.variantType,
              })),
            }));
            try {
              markPaystackReturnPending(window.sessionStorage);
            } catch {
              // Continue to the secure payment page even if this browser blocks session storage.
            }
            window.location.assign(payment.authorizationUrl);
          },
          onError: (caught) => setError(apiErrorMessage(caught, `Order ${order.orderNumber} was created, but payment could not start. Contact us before placing another order.`)),
        });
      },
      onError: (caught) => setError(apiErrorMessage(caught, 'We could not place that order. Please check your details and try again.')),
    });
  };
  const channelLabel = form.paymentChannel === 'mobile_money' ? 'Mobile Money' : form.paymentChannel === 'card' ? 'Card' : 'Bank Transfer';
  const orderCard = (groupItems: CartItem[], availability: 'ghana-stock' | 'pre-order', total: number, groupKey = '') => {
    const preorder = availability === 'pre-order';
    const batchUnassigned = preorder && groupKey === 'legacy';
    const minimum = Number((total * 0.8).toFixed(2));
    const paymentValue = preorderPayments[groupKey] ?? total.toFixed(2);
    return <section key={`${availability}:${groupKey}`} className="rounded-2xl bg-secondary p-5 text-secondary-foreground">
      <div className="flex items-start justify-between gap-3"><div><p className="eyebrow text-accent">{preorder ? 'Pre-order checkout' : 'Ready in Ghana checkout'}</p><h2 className="serif mt-2 text-2xl">{preorder ? (groupKey === 'legacy' ? 'Batch not assigned' : `Shipment batch ${groupKey}`) : 'Ready to prepare'}</h2></div><strong>{money(total)}</strong></div>
      {preorder && <p className="mt-3 rounded-lg bg-secondary-foreground/10 p-3 text-xs leading-5">{batchUnassigned ? 'Awaiting shipment batch assignment. This pre-order cannot be checked out until Ragies assigns it to a shipment batch.' : 'This checkout contains only this shipment batch. Other batches and ready-in-Ghana products are paid in separate orders.'}</p>}
      <div className="mt-5 space-y-4">{groupItems.map((item) => <div key={`${item.product.id}-${item.color}-${item.size}-${item.variantType ?? 'standard'}`} className="flex gap-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.product.name}</p><div className="mt-2 flex items-center gap-2"><button type="button" onClick={() => setQuantity(item.product.id, item.quantity - 1, item.color, item.size, item.variantType)} className="rounded-full border border-secondary-foreground/25 p-1"><Minus size={12} /></button><span className="text-xs">{item.quantity}</span><button type="button" onClick={() => setQuantity(item.product.id, item.quantity + 1, item.color, item.size, item.variantType)} className="rounded-full border border-secondary-foreground/25 p-1"><Plus size={12} /></button><button type="button" onClick={() => removeItem(item.product.id, item.color, item.size, item.variantType)} className="ml-auto text-xs underline">Remove</button></div></div><p className="text-sm font-bold">{money(item.product.price * item.quantity)}</p></div>)}</div>
      {preorder ? <div className="mt-5 rounded-xl bg-secondary-foreground/10 p-4"><label className="block"><span className="text-sm font-bold">{`Pre-order payment (minimum ${money(minimum)})`}</span><input type="text" inputMode="decimal" value={paymentValue} onChange={(event) => { const value = event.target.value; if (/^\d*(?:\.\d{0,2})?$/.test(value)) setPreorderPayments((current) => ({ ...current, [groupKey]: value })); }} required className="mt-2 h-12 w-full rounded-xl border border-secondary-foreground/30 bg-background px-4 text-sm font-semibold text-foreground outline-none focus:border-primary" data-testid={`input-preorder-payment-${groupKey}`} aria-label="Pre-order payment amount" /></label><button type="button" onClick={() => setPreorderPayments((current) => ({ ...current, [groupKey]: minimum.toFixed(2) }))} className="mt-3 rounded-full border border-secondary-foreground/30 px-4 py-2 text-xs font-bold">Pay 80% instead · {money(minimum)}</button><button type="button" onClick={() => setPreorderPayments((current) => ({ ...current, [groupKey]: total.toFixed(2) }))} className="ml-2 mt-3 rounded-full border border-secondary-foreground/30 px-4 py-2 text-xs font-bold">Pay 100%</button></div> : <p className="mt-5 rounded-xl bg-secondary-foreground/10 p-4 text-sm font-bold">Full payment required today: {money(total)}</p>}
      <button type="submit" data-group={preorder ? `pre-order:${groupKey}` : availability} disabled={createOrder.isPending || initializePayment.isPending || batchUnassigned} className="mt-5 w-full rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">{batchUnassigned ? 'Awaiting shipment batch assignment' : createOrder.isPending || initializePayment.isPending ? 'Starting secure payment…' : `Checkout ${preorder ? 'this batch' : 'Ghana-stock'} with ${channelLabel}`}</button>
    </section>;
  };
  return <Page><main className="mx-auto max-w-7xl px-5 py-10 lg:px-8 lg:py-16"><div className="mb-10"><p className="eyebrow text-primary">Separate checkout</p><h1 className="serif mt-2 text-5xl font-semibold">Pay by availability.</h1><p className="mt-3 text-sm text-muted-foreground">Ready-in-Ghana goods stay separate. Each shipment batch also gets its own order and payment, so products from different arrivals are never combined.</p></div>{!items.length ? <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-20 text-center"><ShoppingBag className="mx-auto text-primary" /><h2 className="serif mt-4 text-2xl">Your bag is waiting for a first piece.</h2><Link href="/shop" className="mt-5 inline-flex rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">Browse the shop</Link></div> : <form onSubmit={submit} className="space-y-8"><section className="rounded-2xl bg-card p-5 sm:p-7"><div className="grid gap-4 sm:grid-cols-2"><Field label="Full name" value={form.customerName} onChange={(value) => update('customerName', value)} required testId="input-customer-name" /><Field label="Email for payment receipt" type="email" value={form.email} onChange={(value) => update('email', value)} required testId="input-customer-email" /><Field label="Phone number" type="tel" value={form.phone} onChange={(value) => update('phone', value)} required testId="input-phone" /><Field label="WhatsApp (optional)" type="tel" value={form.whatsapp} onChange={(value) => update('whatsapp', value)} testId="input-whatsapp" />{form.fulfillmentMethod === 'delivery' && <Field label="City" value={form.city} onChange={(value) => update('city', value)} required testId="input-city" />}</div><div className="mt-5"><p className="text-sm font-bold">Fulfilment</p><div className="mt-2 grid grid-cols-2 gap-2">{(['delivery', 'pickup'] as const).map((method) => <button type="button" key={method} onClick={() => update('fulfillmentMethod', method)} className={`rounded-xl border p-3 text-sm font-bold capitalize ${form.fulfillmentMethod === method ? 'border-primary bg-primary/10' : 'border-border'}`}>{method}</button>)}</div></div>{form.fulfillmentMethod === 'delivery' && <label className="mt-5 block"><span className="text-sm font-bold">Delivery address</span><textarea value={form.address} onChange={(event) => update('address', event.target.value)} required rows={3} className="mt-2 w-full rounded-xl border border-input bg-card p-4 text-sm" /></label>}<div className="mt-5"><p className="text-sm font-bold">Paystack method</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{([['mobile_money', 'Mobile money'], ['card', 'Debit / credit card'], ['bank_transfer', 'Bank transfer']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => setForm((current) => ({ ...current, paymentChannel: value }))} className={`rounded-xl border p-3 text-left text-xs font-bold ${form.paymentChannel === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>{label}</button>)}</div></div></section>{ghanaItems.length > 0 && preorderItems.length > 0 && <p className="rounded-xl bg-accent/20 p-4 text-sm font-semibold">Your bag includes ready stock and pre-orders from one or more batches. Submit each card separately; items leave your bag only after verified payment.</p>}<div className="grid gap-5 lg:grid-cols-2">{ghanaItems.length > 0 && orderCard(ghanaItems, 'ghana-stock', ghanaTotal)}{preorderGroups.map((group) => orderCard(group.items, 'pre-order', group.total, group.key))}</div><label className="block"><span className="text-sm font-bold">A note for us (optional)</span><textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} rows={2} className="mt-2 w-full rounded-xl border border-input bg-card p-4 text-sm" /></label>{error && <p className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}</form>}</main></Page>;
}

function LegacyCheckout() {
  const { items, setQuantity, removeItem, clear } = useCart();
  const [, setLocation] = useLocation();
  const createOrder = useCreateOrder();
  const [form, setForm] = useState({ customerName: '', phone: '', whatsapp: '', address: '', city: 'Accra', fulfillmentMethod: 'delivery' as OrderInput['fulfillmentMethod'], notes: '', paymentMethod: 'mobile-money' as OrderInput['paymentMethod'] });
  const [error, setError] = useState('');
  const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const orderItems = items.map((item) => ({ productId: item.product.id, quantity: item.quantity, color: item.color, size: item.size, variantType: item.variantType }));
  const submit = (event: FormEvent) => { event.preventDefault(); if (!items.length) return; setError(''); let promoCode: string | null = null; try { const applied = JSON.parse(sessionStorage.getItem('ragies-applied-promo') || 'null') as { code?: string; valid?: boolean } | null; promoCode = applied?.valid && applied.code ? applied.code : null; } catch { promoCode = null; } createOrder.mutate({ data: { ...form, phone: normalizeContactPhone(form.phone) ?? form.phone.trim(), promoCode, whatsapp: form.whatsapp.trim() ? normalizeContactPhone(form.whatsapp) ?? form.whatsapp.trim() : null, notes: form.notes || null, items: orderItems } }, { onSuccess: (order) => { sessionStorage.setItem(`ragies-invoice-${order.orderNumber}`, JSON.stringify(order)); sessionStorage.removeItem('ragies-applied-promo'); clear(); setLocation(`/order-confirmation/${order.orderNumber}`); }, onError: (caught) => setError(apiErrorMessage(caught, 'We could not place that order. Please check your details and try again.')) }); };
  return <Page><main className="mx-auto max-w-7xl px-5 py-10 lg:px-8 lg:py-16"><div className="mb-10"><p className="eyebrow text-primary">Your order</p><h1 className="serif mt-2 text-5xl font-semibold">A good choice.</h1><p className="mt-3 text-sm text-muted-foreground">Tell us where to bring it. We will confirm the details with you.</p></div>{!items.length ? <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-20 text-center"><ShoppingBag className="mx-auto text-primary" /><h2 className="serif mt-4 text-2xl">Your bag is waiting for a first piece.</h2><Link href="/shop" className="mt-5 inline-flex rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground" data-testid="link-empty-cart-shop">Browse the shop</Link></div> : <div className="grid gap-10 lg:grid-cols-[1fr_380px]"><form onSubmit={submit} className="space-y-8"><div className="grid gap-4 sm:grid-cols-2"><Field label="Full name" value={form.customerName} onChange={(value) => update('customerName', value)} required testId="input-customer-name" /><Field label="Phone number" type="tel" value={form.phone} onChange={(value) => update('phone', value)} required testId="input-phone" /><Field label="WhatsApp (optional)" type="tel" value={form.whatsapp} onChange={(value) => update('whatsapp', value)} testId="input-whatsapp" /><Field label="City" value={form.city} onChange={(value) => update('city', value)} required testId="input-city" /></div><label className="block"><span className="text-sm font-bold">Delivery address</span><textarea value={form.address} onChange={(event) => update('address', event.target.value)} required rows={3} placeholder="Street, landmark, or a useful direction" className="mt-2 w-full resize-none rounded-xl border border-input bg-card p-4 text-sm outline-none focus:border-primary" data-testid="input-address" /></label><div><p className="text-sm font-bold">How would you like to pay?</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{([['mobile-money','Mobile money'],['cash','Cash'],['bank-transfer','Bank transfer'],['pay-on-delivery','Pay on delivery']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => update('paymentMethod', value)} className={`flex items-center justify-between rounded-xl border p-4 text-left text-sm font-semibold ${form.paymentMethod === value ? 'border-primary bg-primary/10' : 'border-border bg-card'}`} data-testid={`button-payment-${value}`}>{label}{form.paymentMethod === value && <Check size={16} className="text-primary" />}</button>)}</div></div><label className="block"><span className="text-sm font-bold">A note for us (optional)</span><textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} rows={2} placeholder="Anything that will help us deliver well?" className="mt-2 w-full resize-none rounded-xl border border-input bg-card p-4 text-sm outline-none focus:border-primary" data-testid="input-order-notes" /></label>{error && <p className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive" data-testid="status-checkout-error">{error}</p>}<button type="submit" disabled={createOrder.isPending} className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-sm font-bold text-primary-foreground disabled:opacity-60" data-testid="button-place-order">{createOrder.isPending ? 'Placing your order…' : <>Place order <ArrowRight size={17} /></>}</button></form><aside className="h-fit rounded-2xl bg-secondary p-5 text-secondary-foreground lg:sticky lg:top-24"><p className="eyebrow text-accent">Order summary</p><div className="mt-5 space-y-4">{items.map((item) => <div key={`${item.product.id}-${item.color}-${item.size}-${item.variantType ?? 'standard'}`} className="flex gap-3" data-testid={`row-cart-item-${item.product.id}`}><div className="h-16 w-14 shrink-0 overflow-hidden bg-primary/30">{item.product.images[0] && <img src={item.product.images[0]} alt="" className="h-full w-full object-cover" />}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.product.name}</p><p className="mt-1 text-xs text-secondary-foreground/60">{item.variantType ? `${item.variantType} · ` : ''}{item.size || 'One size'} · {item.color || 'Standard'}</p><div className="mt-2 flex items-center gap-2"><button onClick={() => setQuantity(item.product.id, item.quantity - 1, item.color, item.size, item.variantType)} className="rounded-full border border-secondary-foreground/25 p-1" data-testid={`button-decrease-${item.product.id}`}><Minus size={12} /></button><span className="text-xs">{item.quantity}</span><button onClick={() => setQuantity(item.product.id, item.quantity + 1, item.color, item.size, item.variantType)} className="rounded-full border border-secondary-foreground/25 p-1" data-testid={`button-increase-${item.product.id}`}><Plus size={12} /></button><button onClick={() => removeItem(item.product.id, item.color, item.size, item.variantType)} className="ml-auto text-xs text-secondary-foreground/60 underline" data-testid={`button-remove-${item.product.id}`}>Remove</button></div></div><p className="text-sm font-bold">{money(item.product.price * item.quantity, item.product.currency)}</p></div>)}</div><div className="mt-6 flex items-end justify-between border-t border-secondary-foreground/20 pt-5"><span className="text-sm text-secondary-foreground/70">Total</span><span className="serif text-3xl">{money(total)}</span></div><p className="mt-4 text-xs leading-5 text-secondary-foreground/55">No surprise charges at checkout. We will confirm delivery timing after your order arrives.</p></aside></div>}</main></Page>;
}
function Field({ label, value, onChange, type = 'text', required = false, testId }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; testId: string }) {
  if (testId === 'input-product-image' || testId === 'input-edit-product-image') {
    return <ProductImageUpload value={value} onChange={onChange} />;
  }
  if (type === 'tel') {
    const phoneField = <PhoneInput label={label} value={value} onChange={onChange} required={required} testId={testId} />;
    return testId === 'input-whatsapp' ? <>{phoneField}<div className="sm:col-span-2"><CheckoutPromotionPanel /></div></> : phoneField;
  }
  const field = <label className="block"><span className="text-sm font-bold">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-sm outline-none focus:border-primary" data-testid={testId} /></label>;
  if (testId === 'input-product-price') return <>{field}<ProductCostFields prefix="product" /></>;
  if (testId === 'input-edit-product-price') return <>{field}<ProductCostFields prefix="edit-product" /></>;
  if (testId === 'input-manual-city') return <ManualFulfillmentField value={value} onChange={onChange} />;
  return field;
}

function ManualFulfillmentField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [method, setMethod] = useState<'delivery' | 'pickup'>('delivery');
  return <div className="sm:col-span-2"><span className="text-sm font-bold">Fulfilment</span><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => { setMethod('delivery'); onChange('__delivery__'); }} className={`rounded-xl border p-3 text-sm font-bold ${method === 'delivery' ? 'border-primary bg-primary/10' : 'border-border'}`} data-testid="button-manual-fulfillment-delivery">Delivery</button><button type="button" onClick={() => { setMethod('pickup'); onChange('__pickup__'); }} className={`rounded-xl border p-3 text-sm font-bold ${method === 'pickup' ? 'border-primary bg-primary/10' : 'border-border'}`} data-testid="button-manual-fulfillment-pickup">Pickup</button></div>{method === 'delivery' ? <label className="mt-3 block"><span className="text-sm font-bold">City</span><input value={value === '__delivery__' || value === '__pickup__' ? 'Accra' : value} onChange={(event) => onChange(event.target.value)} required className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-sm" data-testid="input-manual-city" /></label> : <div className="mt-3 rounded-xl bg-primary/5 p-3 text-sm"><p className="font-bold">Pickup from Ragies Imports</p><p className="text-muted-foreground">Tafo, Kumasi. We will contact you when it is ready.</p></div>}</div>;
}

function Confirmation() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const queryClient = useQueryClient();
  const { items, removeItem, setQuantity } = useCart();
  const [order, setOrder] = useState<Order | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(`ragies-invoice-${orderNumber}`) || 'null') as Order | null; } catch { return null; }
  });
  const invoiceContact = useContactPhoneDefault();
  const phone = invoiceContact.value;
  const setPhone = invoiceContact.onChange;
  const [lookupPhone, setLookupPhone] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(`ragies-pending-checkout-${orderNumber}`) || 'null')?.phone || order?.phone || ''; } catch { return order?.phone || ''; }
  });
  const lookup = useTrackOrder({ orderNumber, phone: lookupPhone }, { query: { ...orderFreshness, enabled: Boolean(lookupPhone), retry: false, queryKey: getTrackOrderQueryKey({ orderNumber, phone: lookupPhone }) } });
  useEffect(() => { if (lookup.data) { setOrder(lookup.data); sessionStorage.setItem(`ragies-invoice-${orderNumber}`, JSON.stringify(lookup.data)); } }, [lookup.data, orderNumber]);
  useEffect(() => {
    const paymentSucceeded = new URLSearchParams(window.location.search).get('payment') === 'success';
    const pendingKey = `ragies-pending-checkout-${orderNumber}`;
    if (!paymentSucceeded) return;
    try {
      const pending = JSON.parse(sessionStorage.getItem(pendingKey) || 'null') as { phone?: string; items?: Array<{ productId: number; quantity: number; color: string | null; size: string | null; variantType: string | null }> } | null;
      if (!pending || !lookup.data || lookup.data.amountPaid <= 0 || lookup.data.paymentStatus === 'unpaid') return;
      (pending?.items ?? []).forEach((paidItem) => {
        const cartItem = items.find((item) => item.product.id === paidItem.productId && item.color === paidItem.color && item.size === paidItem.size && item.variantType === paidItem.variantType);
        if (!cartItem) return;
        if (cartItem.quantity <= paidItem.quantity) removeItem(paidItem.productId, paidItem.color, paidItem.size, paidItem.variantType);
        else setQuantity(paidItem.productId, cartItem.quantity - paidItem.quantity, paidItem.color, paidItem.size, paidItem.variantType);
      });
      if (pending?.phone) setLookupPhone(pending.phone);
      sessionStorage.removeItem(pendingKey);
      void queryClient.invalidateQueries({ queryKey: getListMyOrdersQueryKey() });
    } catch {
      sessionStorage.removeItem(pendingKey);
    }
  }, [items, orderNumber, removeItem, setQuantity, lookup.data]);
  const submitInvoiceLookup = (event: FormEvent) => {
    event.preventDefault();
    const normalizedPhone = normalizeContactPhone(phone) ?? phone.trim();
    if (lookupPhone === normalizedPhone) void lookup.refetch();
    else setLookupPhone(normalizedPhone);
  };
  return <Page><main className="mx-auto max-w-4xl px-5 py-12 lg:px-8 lg:py-20">
    <div className="print:hidden text-center"><div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-accent"><Check className="text-accent-foreground" size={34} /></div><p className="eyebrow mt-8 text-primary">Order placed</p><h1 className="serif mt-3 text-5xl font-semibold">We have it from here.</h1><p className="mx-auto mt-5 max-w-md leading-7 text-muted-foreground">Your order number is <strong className="text-foreground" data-testid="text-order-number">{orderNumber}</strong>. Keep it close for tracking and invoice access.</p></div>
    {!order ? <form onSubmit={submitInvoiceLookup} className="mx-auto mt-10 max-w-md rounded-2xl bg-card p-6 print:hidden"><p className="font-bold">Open your invoice</p><p className="mt-1 text-sm text-muted-foreground">Enter the phone number used at checkout.</p><div className="mt-4"><PhoneInput label="Checkout phone number" value={phone} onChange={setPhone} required testId="input-confirmation-phone" /><button className="mt-3 min-h-11 w-full rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">{lookup.isFetching ? 'Opening…' : 'Open invoice'}</button></div>{lookup.isError && <p className="mt-3 text-sm text-destructive">Could not open this invoice. Check the order details and try again.</p>}</form> : <><div className="mt-10 flex flex-wrap justify-center gap-3 print:hidden"><button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground" data-testid="button-print-customer-invoice"><Printer size={16} /> Print invoice</button><Link href="/track-order" className="inline-flex items-center justify-center gap-2 rounded-full border border-border px-6 py-3.5 text-sm font-bold">Track order <ArrowRight size={16} /></Link><Link href="/shop" className="inline-flex items-center justify-center rounded-full border border-border px-6 py-3.5 text-sm font-bold">Keep shopping</Link></div>{lookup.isError && <p role="alert" className="mt-5 rounded-xl border border-destructive/30 p-4 text-sm text-destructive">This is a saved invoice; its latest details could not be refreshed. Check your account or track the order again using the current phone number.</p>}<CustomerInvoice order={order} /></>}
  </main></Page>;
}

function CustomerInvoice({ order }: { order: Order }) {
  const progress = paymentProgress(order);
  return <section className="invoice-print mt-10 rounded-2xl border border-border bg-card p-6 text-left sm:p-9" aria-label={`Invoice ${order.orderNumber}`}>
    <div className="flex flex-col justify-between gap-5 border-b border-border pb-6 sm:flex-row">
      <div className="flex items-center gap-3"><BrandLogo framed className="h-14 w-[6.75rem]" /><p className="text-xs text-muted-foreground">Customer invoice</p></div>
      <div className="sm:text-right">
        <p className="eyebrow text-primary">{progress.partiallyPaid ? 'Part-payment invoice' : 'Invoice'}</p>
        <p className="mt-2 text-xl font-bold">{order.orderNumber}</p>
        <p className="mt-1 text-xs text-muted-foreground">{date(order.createdAt)}</p>
      </div>
    </div>
    <div className="grid gap-5 border-b border-border py-6 text-sm sm:grid-cols-2">
      <div><p className="eyebrow text-muted-foreground">Billed to</p><p className="mt-2 font-bold">{order.customerName}</p><p className="mt-1 text-muted-foreground">{order.phone}{order.whatsapp ? ` · WhatsApp ${order.whatsapp}` : ''}</p></div>
      <div className="sm:text-right"><p className="eyebrow text-muted-foreground">{order.fulfillmentMethod === 'pickup' ? 'Pickup' : 'Delivery'}</p><p className="mt-2 font-semibold">{order.address}</p><p className="mt-1 text-muted-foreground">{order.city}</p></div>
    </div>
    <div className="py-6">
      <div className="hidden grid-cols-[1fr_80px_120px_120px] gap-3 border-b border-border pb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground sm:grid"><span>Item</span><span className="text-right">Qty</span><span className="text-right">Unit price</span><span className="text-right">Amount</span></div>
      <div className="divide-y divide-border">{order.items.map((item, index) => <div key={`${item.productId}-${index}`} className="grid gap-2 py-4 sm:grid-cols-[1fr_80px_120px_120px] sm:items-center sm:gap-3">
        <div><p className="font-bold">{item.productName}</p><p className="mt-1 text-xs text-muted-foreground">{[item.color, item.size, item.availability === 'pre-order' ? 'Pre-order' : 'Ready in Ghana'].filter(Boolean).join(' · ')}</p></div>
        <div className="flex justify-between sm:block sm:text-right"><span className="text-xs text-muted-foreground sm:hidden">Quantity</span><span>{item.quantity}</span></div>
        <div className="flex justify-between sm:block sm:text-right"><span className="text-xs text-muted-foreground sm:hidden">Unit price</span><span>{money(item.unitPrice)}</span></div>
        <div className="flex justify-between font-bold sm:block sm:text-right"><span className="text-xs font-normal text-muted-foreground sm:hidden">Amount</span><span>{money(item.unitPrice * item.quantity)}</span></div>
      </div>)}</div>
    </div>
    <div className="ml-auto max-w-md space-y-3 border-t border-border pt-5">
      <OrderPaymentSummary order={order} />
      <div className="flex justify-between text-xs"><span className="text-muted-foreground">Payment method</span><span className="font-semibold capitalize">{order.paymentMethod.replaceAll('-', ' ')}</span></div>
    </div>
    <p className="mt-8 border-t border-border pt-5 text-center text-xs text-muted-foreground">Thank you for shopping with Ragies Imports. Keep this invoice and order number for your records.</p>
  </section>;
}

function TrackOrder() {
  const trackContact = useContactPhoneDefault();
  const [fieldDraft, setFieldDraft] = useState({ orderNumber: '', phone: '' });
  const fields = { ...fieldDraft, phone: trackContact.value };
  const setFields = (next: typeof fields) => {
    if (next.phone !== fields.phone) trackContact.onChange(next.phone);
    setFieldDraft(next);
  };
  const [params, setParams] = useState({ orderNumber: '', phone: '' });
  const lookup = useTrackOrder(params, { query: { ...orderFreshness, enabled: Boolean(params.orderNumber && params.phone), retry: false, queryKey: getTrackOrderQueryKey(params) } });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = { orderNumber: fields.orderNumber.trim().toUpperCase(), phone: normalizeContactPhone(fields.phone) ?? fields.phone.trim() };
    if (next.orderNumber === params.orderNumber && next.phone === params.phone) void lookup.refetch();
    else setParams(next);
  };
  return <Page><main className="mx-auto max-w-5xl px-5 py-12 lg:px-8 lg:py-20"><div className="grid gap-12 lg:grid-cols-[.85fr_1.15fr]"><div><p className="eyebrow text-primary">Order care</p><h1 className="serif mt-3 text-6xl font-semibold leading-[.93]">Where is<br />my order?</h1><p className="mt-6 max-w-sm leading-7 text-muted-foreground">Enter the order number from your confirmation and the phone number used at checkout. We only use them to find your order.</p><form onSubmit={submit} className="mt-8 space-y-4"><Field label="Order number" value={fields.orderNumber} onChange={(value) => setFields({ ...fields, orderNumber: value })} required testId="input-track-order-number" /><Field label="Phone number" type="tel" value={fields.phone} onChange={(value) => setFields({ ...fields, phone: value })} required testId="input-track-phone" /><button className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-sm font-bold text-primary-foreground" data-testid="button-track-order">{lookup.isFetching ? 'Looking it up…' : <>Find my order <ArrowRight size={16} /></>}</button></form></div><div className="min-h-80 rounded-2xl bg-secondary p-6 text-secondary-foreground sm:p-10">{!params.orderNumber ? <div className="flex h-full flex-col items-center justify-center text-center"><Package size={36} className="text-accent" /><p className="serif mt-5 text-3xl">Your order, in plain view.</p><p className="mt-2 max-w-xs text-sm leading-6 text-secondary-foreground/65">Status, payment, and shipment details will appear here.</p></div> : lookup.isLoading ? <div className="space-y-5"><div className="skeleton h-4 w-32" /><div className="skeleton h-9 w-3/4" /><div className="skeleton h-24 w-full" /></div> : lookup.isError || !lookup.data ? <div className="flex h-full flex-col items-center justify-center text-center"><XCircle size={34} className="text-accent" /><p className="serif mt-4 text-2xl">We couldn't find that order.</p><p className="mt-2 max-w-xs text-sm leading-6 text-secondary-foreground/65">Check the number and phone exactly as entered at checkout.</p></div> : <OrderStatus order={lookup.data} />}</div></div></main></Page>;
}
function Account() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [location] = useLocation();
  const showingOrders = location === '/account/orders';
  const orders = useListMyOrders({
    query: {
      queryKey: [...getListMyOrdersQueryKey(), userId],
      enabled: Boolean(isLoaded && isSignedIn && showingOrders),
      ...orderFreshness,
    },
  });
  if (!isLoaded) return <Page><main className="mx-auto max-w-5xl px-5 py-20"><div className="skeleton h-48 rounded-2xl" /></main></Page>;
  if (!isSignedIn) return <Page><main className="mx-auto max-w-xl px-5 py-24 text-center"><UserRound className="mx-auto text-primary" size={34} /><h1 className="serif mt-5 text-4xl font-semibold">Your account, all together.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Sign in to see your account details and orders.</p><Link href="/sign-in" className="mt-7 inline-flex rounded-full bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground">Sign in</Link></main></Page>;
  return <Page><main className="mx-auto max-w-5xl px-5 py-12 lg:px-8 lg:py-20">
    <div className="flex flex-col justify-between gap-5 border-b border-border pb-8 sm:flex-row sm:items-end">
      <div><p className="eyebrow text-primary">Your account</p><h1 className="serif mt-2 text-5xl font-semibold">{showingOrders ? 'Your orders.' : 'Your profile.'}</h1><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{showingOrders ? 'Your orders, payments and delivery updates in one place.' : 'View your account details and manage your sign-in settings.'}</p></div>
      <Link href="/shop" className="inline-flex items-center gap-2 text-sm font-bold text-primary">Shop <ArrowRight size={15} /></Link>
    </div>
    <nav aria-label="Account sections" className="mt-7 flex gap-2 border-b border-border pb-4">
      <Link href="/account" aria-current={!showingOrders ? 'page' : undefined} data-testid="account-tab-profile" className={`inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-primary ${!showingOrders ? 'bg-secondary text-secondary-foreground' : 'bg-card hover:bg-muted'}`}><UserRound size={16} /> Profile</Link>
      <Link href="/account/orders" aria-current={showingOrders ? 'page' : undefined} data-testid="account-tab-orders" className={`inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-primary ${showingOrders ? 'bg-secondary text-secondary-foreground' : 'bg-card hover:bg-muted'}`}><ShoppingBag size={16} /> Orders</Link>
    </nav>
    {!showingOrders ? <div className="mt-8"><AccountProfile key={userId} /></div> : <div className="mt-8">
      {orders.isError ? <QueryError retry={() => orders.refetch()} /> : orders.isLoading ? <div className="space-y-3">{[1,2,3].map((item) => <div key={item} className="skeleton h-32 rounded-2xl" />)}</div> : !orders.data?.length ? <div className="rounded-2xl border border-dashed border-border bg-card p-16 text-center"><ShoppingBag className="mx-auto text-primary" /><h2 className="serif mt-4 text-2xl">No account orders yet.</h2><p className="mt-2 text-sm text-muted-foreground">Place your next order while signed in and it will be saved here.</p><Link href="/shop" className="mt-5 inline-flex rounded-full bg-secondary px-5 py-2.5 text-sm font-bold text-secondary-foreground">Browse the shop</Link></div> : <div className="space-y-3">
        {orders.data.map((order) => <div key={order.id} className="rounded-2xl bg-card p-5 sm:flex sm:items-center sm:gap-5" data-testid={`account-order-${order.id}`}>
      <div className="flex-1"><div className="flex flex-wrap items-center gap-3"><p className="font-bold">{order.orderNumber}</p><span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em]">{order.status}</span><span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em]">{paymentProgress(order).label}</span></div><p className="mt-2 text-sm text-muted-foreground">{date(order.createdAt)} · {order.items.reduce((sum, item) => sum + item.quantity, 0)} item(s)</p><EtaUpdates order={order} /><OrderFinance order={order} paymentActions /></div>
          <div className="mt-4 min-w-56 sm:mt-0 sm:max-w-sm">
            <OrderPaymentSummary order={order} />
            <Link href={`/track-order?order=${order.orderNumber}`} className="mt-3 block text-right text-sm font-bold text-primary">Track <ArrowRight className="inline" size={14} /></Link>
          </div>
        </div>)}
      </div>}
    </div>}
  </main></Page>;
}
function OrderStatus({ order }: { order: Order }) {
  return <div><div className="flex items-start justify-between gap-3"><div><p className="eyebrow text-accent">Order found</p><h2 className="serif mt-2 text-3xl">{order.orderNumber}</h2></div><span className="rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-foreground">{order.paymentStatus}</span></div><EtaUpdates order={order} inverse /><OrderFinance order={order} inverse /><OrderProgress order={order} /><div className="mt-8 grid grid-cols-2 gap-3 border-t border-secondary-foreground/15 pt-5 text-sm"><div><p className="text-xs text-secondary-foreground/55">{order.fulfillmentMethod === 'pickup' ? 'Pickup location' : 'Delivering to'}</p><p className="mt-1 font-semibold">{order.city}</p></div><div><p className="text-xs text-secondary-foreground/55">Total</p><p className="mt-1 font-semibold">{money(order.totalAmount)}</p></div></div></div>;
}

function OrderFinance({ order, inverse = false, paymentActions = false }: { order: Order; inverse?: boolean; paymentActions?: boolean }) {
  const extended = order as Order & { minimumPaymentAmount?: number; baseBalance?: number; shippingBalance?: number; shippingFeeTotal?: number; shippingFeePaid?: number; trackingId?: string | null; shippingId?: string | null; pickupId?: string | null; preorderPickupId?: string | null; canPayBalance?: boolean; canPayShippingFee?: boolean };
  const tone = inverse ? 'text-secondary-foreground/75' : 'text-muted-foreground';
  const preorder = order.items.some((item) => item.availability === 'pre-order');
  const minimumPercent = preorder ? 80 : 100;
  return <div className={`mt-5 rounded-xl p-4 text-xs ${inverse ? 'bg-secondary-foreground/10' : 'bg-primary/5'}`} data-testid={`order-finance-${order.id}`}>
    <p className="font-bold">Payment plan</p>
    <div className={`mt-3 grid grid-cols-2 gap-3 ${tone}`}>
      <span>Minimum payment ({minimumPercent}%)<strong className="mt-1 block text-sm text-current">{money(extended.minimumPaymentAmount ?? order.totalAmount * minimumPercent / 100)}</strong></span>
      <span>Goods balance<strong className="mt-1 block text-sm text-current">{money(extended.baseBalance ?? paymentProgress(order).balance)}</strong></span>
      <span>Shipping balance<strong className="mt-1 block text-sm text-current">{money(extended.shippingBalance ?? Math.max(0, (extended.shippingFeeTotal ?? 0) - (extended.shippingFeePaid ?? 0)))}</strong></span>
      <span>Shipping status<strong className="mt-1 block text-sm text-current">{extended.shippingFeeTotal ? 'Shipping fee assigned' : preorder ? 'Deferred until arrival' : 'No international shipping fee'}</strong></span>
    </div>
    {paymentActions && <AccountPaymentActions order={extended} />}
    <div className={`mt-4 grid gap-1 border-t border-current/15 pt-3 ${tone}`}>
      {extended.trackingId && <span>Tracking ID: <strong>{extended.trackingId}</strong></span>}
      {extended.shippingId && <span>Shipping ID: <strong>{extended.shippingId}</strong></span>}
      {extended.pickupId && <span>Pickup ID: <strong>{extended.pickupId}</strong></span>}
      {extended.preorderPickupId && <span>Pre-order pickup ID: <strong>{extended.preorderPickupId}</strong></span>}
    </div>
  </div>;
}

function AccountPaymentActions({ order }: { order: Order & { canPayBalance?: boolean; canPayShippingFee?: boolean; baseBalance?: number; shippingBalance?: number } }) {
  const prepare = usePrepareOrderPayment();
  const [details, setDetails] = useState<PaymentPreparation | null>(null);
  const begin = (purpose: 'merchandise-balance' | 'shipping-fee') => {
    setDetails(null);
    prepare.mutate({ id: order.id, data: { purpose } }, {
      onSuccess: (payment) => {
        setDetails(payment);
        if (payment.providerReady && payment.authorizationUrl) window.location.assign(payment.authorizationUrl);
      },
    });
  };
  if (!order.canPayBalance && !order.canPayShippingFee) return null;
  return <div className="mt-4 border-t border-current/15 pt-4">
    <div className="flex flex-wrap gap-2">
      {order.canPayBalance && <button type="button" onClick={() => begin('merchandise-balance')} disabled={prepare.isPending} className="rounded-full bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-60" data-testid={`button-pay-balance-${order.id}`}>Pay arrears · {money(order.baseBalance ?? order.balance)}</button>}
      {order.canPayShippingFee && <button type="button" onClick={() => begin('shipping-fee')} disabled={prepare.isPending} className="rounded-full bg-secondary px-4 py-2 font-bold text-secondary-foreground disabled:opacity-60" data-testid={`button-pay-shipping-${order.id}`}>Pay shipping fee · {money(order.shippingBalance ?? 0)}</button>}
    </div>
    {prepare.isError && <p className="mt-3 rounded-lg bg-destructive/10 p-3 text-destructive">{apiErrorMessage(prepare.error, 'Could not prepare this payment.')}</p>}
    {details && <div className="mt-3 rounded-xl border border-primary/20 bg-background p-4" data-testid={`payment-summary-${order.id}`}><p className="font-bold">{details.purpose === 'shipping-fee' ? 'Shipping fee payment' : 'Goods balance payment'}</p><p className="mt-1 text-sm">Amount due: <strong>{money(details.amount)}</strong></p><p className="mt-2 text-muted-foreground">{details.message}</p><a href={details.authorizationUrl} className="mt-3 block w-full rounded-full bg-primary px-4 py-2.5 text-center font-bold text-primary-foreground">Continue with Paystack</a></div>}
  </div>;
}

function EtaUpdates({ order, inverse = false }: { order: Order; inverse?: boolean }) {
  const updates = order.items.filter((item) => item.availability === 'pre-order' && item.currentEta && item.currentEta !== item.eta);
  if (!updates.length) return null;
  return <div className={`mt-3 rounded-xl p-3 text-xs ${inverse ? 'bg-secondary-foreground/10 text-secondary-foreground' : 'bg-primary/10 text-foreground'}`} data-testid={`eta-updates-${order.id}`}><p className="font-bold">Pre-order ETA update</p>{updates.map((item, index) => <p key={`${item.productId}-${index}`} className={`mt-1 ${inverse ? 'text-secondary-foreground/70' : 'text-muted-foreground'}`}>{item.productName}: expected {date(item.currentEta)}</p>)}</div>;
}

function About() {
  const content = useGetSiteContent();
  return <Page><main>
    <section className="bg-secondary px-5 py-16 text-secondary-foreground lg:px-8 lg:py-28"><div className="mx-auto max-w-7xl">
      <p className="eyebrow text-accent">The Ragies way</p>
      <h1 className="serif mt-5 max-w-3xl text-5xl font-semibold leading-tight sm:text-7xl">{content.data?.aboutTitle ?? "Quality goods, within everybody's reach."}</h1>
      <p className="mt-8 max-w-xl text-lg leading-8 text-secondary-foreground/80">Ragie's Imports exists to make quality goods available and affordable to everybody.</p>
    </div></section>
    <section className="mx-auto grid max-w-7xl gap-8 px-5 py-16 lg:grid-cols-[.8fr_1.2fr] lg:px-8"><div><p className="eyebrow text-primary">Our story</p><h2 className="serif mt-3 text-4xl font-semibold">Quality without the high price.</h2></div><div className="space-y-5 text-base leading-8 text-muted-foreground">
      <p>{content.data?.aboutStory ?? "We source fashion, accessories, and useful everyday products with care, bringing dependable quality closer to our customers in Ghana at accessible prices."}</p>
      <p>Some products are already in Ghana. Others are available by pre-order, with a closing date and estimated arrival shown before you buy.</p>
    </div></section>
    <section className="paper-grid border-y border-border px-5 py-16 lg:px-8"><div className="mx-auto max-w-7xl"><SectionHeading kicker="Buying guide" title="Two ways to shop." /><div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl bg-accent p-7"><h3 className="serif text-3xl font-semibold">Ready in Ghana</h3><p className="mt-4 text-sm leading-6">These goods are already in Ghana and require full payment at checkout. Choose delivery or pickup when ordering.</p></div>
      <div className="rounded-2xl bg-card p-7"><h3 className="serif text-3xl font-semibold">Pre-order</h3><p className="mt-4 text-sm leading-6 text-muted-foreground">Pay at least 80% of the goods total to place your order. International shipping fees are charged separately after the batch arrives in Ghana. Arrival dates are estimates, not guarantees.</p></div>
    </div></div></section>
    <section className="mx-auto max-w-7xl px-5 py-16 lg:px-8"><Link href="/shop" className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground" data-testid="button-about-shop">Shop <ArrowRight size={16} /></Link></section>
  </main></Page>;
}

function CheckoutPromotionPanel() {
  const { items } = useCart();
  const previewPromotion = usePreviewPromotion();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ valid: boolean; message: string; discount: number; total: number } | null>(null);
  useEffect(() => { setResult(null); sessionStorage.removeItem('ragies-applied-promo'); }, [items]);
  const preview = () => previewPromotion.mutate({ data: { code: code.trim(), items: items.map((item) => ({ productId: item.product.id, quantity: item.quantity, color: item.color, size: item.size })) } }, { onSuccess: (value) => { setResult(value); if (value.valid) sessionStorage.setItem('ragies-applied-promo', JSON.stringify({ code: code.trim(), valid: true })); else sessionStorage.removeItem('ragies-applied-promo'); }, onError: () => { setResult({ valid: false, message: 'We could not check that code right now.', discount: 0, total: 0 }); sessionStorage.removeItem('ragies-applied-promo'); } });
  return <div className="rounded-2xl border border-border bg-card p-5" data-testid="panel-checkout-promotion"><p className="text-sm font-bold">Promotion code</p><div className="mt-3 flex gap-2"><input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setResult(null); sessionStorage.removeItem('ragies-applied-promo'); }} placeholder="Enter code" className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-4 text-sm" data-testid="input-promo-code" /><button type="button" onClick={preview} disabled={!code.trim() || previewPromotion.isPending} className="rounded-xl bg-secondary px-4 text-xs font-bold text-secondary-foreground disabled:opacity-40" data-testid="button-preview-promotion">Apply</button></div>{result && <p className={`mt-3 text-sm ${result.valid ? 'text-primary' : 'text-destructive'}`} data-testid="status-promotion-preview">{result.valid ? `${result.message} Saving ${money(result.discount)}. New total ${money(result.total)}.` : result.message}</p>}</div>;
}

function Promotions() {
  const promotions = useListPromotions({ query: { queryKey: getListPromotionsQueryKey() } });
  const products = useListProducts({ sort: 'featured' }, { query: { queryKey: getListProductsQueryKey({ sort: 'featured' }) } });
  const active = (promotions.data ?? []).filter((promotion) => promotion.currentlyActive);
  const discounted = (products.data ?? []).filter((product) => product.compareAtPrice && product.compareAtPrice > product.price);
  return <Page><main className="mx-auto max-w-7xl px-5 py-12 lg:px-8 lg:py-16"><div className="rounded-3xl bg-secondary p-7 text-secondary-foreground sm:p-12"><p className="eyebrow text-accent">The Ragies offers edit</p><h1 className="serif mt-4 max-w-2xl text-5xl font-semibold leading-none sm:text-7xl">Good pieces.<br /><span className="text-primary">Better timing.</span></h1><p className="mt-6 max-w-xl text-sm leading-7 text-secondary-foreground/70">Straightforward savings on considered pieces, with the original price always visible.</p></div><section className="mt-14"><SectionHeading kicker="Current offers" title="Worth a closer look." />{promotions.isLoading ? <div className="grid gap-4 md:grid-cols-2">{[1,2].map((i) => <div className="skeleton h-36 rounded-2xl" key={i} />)}</div> : promotions.isError ? <QueryError retry={() => promotions.refetch()} /> : !active.length ? <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground" data-testid="empty-promotions">No public promotions are running right now.</div> : <div className="grid gap-4 md:grid-cols-2">{active.map((promotion) => <article key={promotion.id} className="rounded-2xl border border-border bg-card p-6" data-testid={`card-promotion-${promotion.id}`}><div className="flex items-start justify-between gap-4"><div><p className="eyebrow text-primary">{promotion.code ? `Code ${promotion.code}` : 'Automatic saving'}</p><h2 className="serif mt-2 text-2xl font-semibold">{promotion.name}</h2></div><span className="rounded-full bg-accent px-3 py-1 text-xs font-bold">{promotion.discountType === 'percentage' ? `${promotion.discountValue}% off` : `${money(promotion.discountValue)} off`}</span></div><p className="mt-3 text-sm leading-6 text-muted-foreground">{promotion.description || 'A considered saving from Ragies Imports.'}</p></article>)}</div>}</section><section className="mt-16"><SectionHeading kicker="Marked down now" title="The clear-price edit." /><div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">{discounted.map((product) => <ProductCard key={product.id} product={product} />)}</div></section></main></Page>;
}

function AdminPromotions() {
  const queryClient = useQueryClient();
  const list = useListAdminPromotions({ query: { queryKey: getListAdminPromotionsQueryKey() } });
  const products = useListProducts({ sort: 'featured' }, { query: { queryKey: getListProductsQueryKey({ sort: 'featured' }) } });
  const create = useCreatePromotion(); const update = useUpdatePromotion(); const remove = useDeletePromotion();
  const [editing, setEditing] = useState<Promotion | null>(null); const [open, setOpen] = useState(false);
  const blank = { name: '', description: '', discountType: 'percentage' as 'percentage' | 'fixed', discountValue: '10', code: '', scope: 'all' as 'all' | 'specific' | 'clearance', productIds: [] as number[], startsOn: '', endsOn: '', active: true };
  const [form, setForm] = useState(blank);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: getListAdminPromotionsQueryKey() }); void queryClient.invalidateQueries({ queryKey: getListPromotionsQueryKey() }); void queryClient.invalidateQueries({ queryKey: ['/api/products'] }); };
  const startEdit = (promotion?: Promotion) => { setEditing(promotion ?? null); setForm(promotion ? { name: promotion.name, description: promotion.description, discountType: promotion.discountType, discountValue: String(promotion.discountValue), code: promotion.code ?? '', scope: promotion.scope, productIds: promotion.productIds, startsOn: promotion.startsOn?.slice(0, 10) ?? '', endsOn: promotion.endsOn?.slice(0, 10) ?? '', active: promotion.active } : blank); setOpen(true); };
  const submit = (event: FormEvent) => { event.preventDefault(); const data: PromotionInput = { name: form.name, description: form.description, discountType: form.discountType, discountValue: Number(form.discountValue), code: form.code.trim() || null, scope: form.scope, productIds: form.scope === 'specific' ? form.productIds : [], startsOn: form.startsOn || null, endsOn: form.endsOn || null, active: form.active }; const done = () => { setOpen(false); refresh(); }; editing ? update.mutate({ id: editing.id, data }, { onSuccess: done }) : create.mutate({ data }, { onSuccess: done }); };
  return <AdminShell><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow text-primary">Campaign controls</p><h1 className="serif mt-2 text-4xl font-semibold">Promotions.</h1><p className="mt-2 text-sm text-muted-foreground">Keep savings clear for customers and quick to operate.</p></div><button onClick={() => startEdit()} className="rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground" data-testid="button-create-promotion">New promotion</button></div><div className="mt-8 space-y-3">{list.isLoading ? [1,2,3].map((i) => <div className="skeleton h-28 rounded-2xl" key={i} />) : list.isError ? <QueryError retry={() => list.refetch()} /> : (list.data ?? []).map((promotion) => <div key={promotion.id} className="flex flex-col gap-4 rounded-2xl bg-card p-5 sm:flex-row sm:items-center" data-testid={`row-promotion-${promotion.id}`}><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">{promotion.name}</h2><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${promotion.currentlyActive ? 'bg-accent' : 'bg-muted text-muted-foreground'}`}>{promotion.currentlyActive ? 'Live' : promotion.active ? 'Scheduled' : 'Paused'}</span></div><p className="mt-1 text-sm text-muted-foreground">{promotion.discountType === 'percentage' ? `${promotion.discountValue}% off` : `${money(promotion.discountValue)} off`} · {promotion.scope} {promotion.code ? `· ${promotion.code}` : ''}</p></div><div className="flex gap-2"><button onClick={() => startEdit(promotion)} className="rounded-full border border-border px-4 py-2 text-xs font-bold" data-testid={`button-edit-promotion-${promotion.id}`}>Edit</button><button onClick={() => { if (window.confirm('Delete this promotion?')) remove.mutate({ id: promotion.id }, { onSuccess: refresh }); }} className="rounded-full border border-destructive/30 px-4 py-2 text-xs font-bold text-destructive" data-testid={`button-delete-promotion-${promotion.id}`}>Delete</button></div></div>)}</div>{open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-secondary/50 sm:items-center sm:p-6"><form onSubmit={submit} className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-background p-6 sm:rounded-3xl"><div className="flex items-center justify-between"><div><p className="eyebrow text-primary">{editing ? 'Edit campaign' : 'New campaign'}</p><h2 className="serif mt-2 text-3xl">{editing ? editing.name : 'Create promotion'}</h2></div><button type="button" onClick={() => setOpen(false)} className="rounded-full border border-border p-2" data-testid="button-close-promotion"><X size={17} /></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><Field label="Promotion name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required testId="input-promotion-name" /><Field label="Code (optional)" value={form.code} onChange={(v) => setForm({ ...form, code: v.toUpperCase() })} testId="input-promotion-code" /><label><span className="text-sm font-bold">Discount type</span><select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as 'percentage' | 'fixed' })} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-sm" data-testid="select-promotion-discount-type"><option value="percentage">Percentage</option><option value="fixed">Fixed GHS</option></select></label><Field label={form.discountType === 'percentage' ? 'Percent off' : 'Amount off (GHS)'} type="number" value={form.discountValue} onChange={(v) => setForm({ ...form, discountValue: v })} required testId="input-promotion-value" /><label className="sm:col-span-2"><span className="text-sm font-bold">Description</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="mt-2 w-full rounded-xl border border-input bg-card p-4 text-sm" data-testid="input-promotion-description" /></label><label><span className="text-sm font-bold">Applies to</span><select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as typeof form.scope })} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-sm" data-testid="select-promotion-scope"><option value="all">All products</option><option value="specific">Selected products</option><option value="clearance">Clearance items</option></select></label><label className="flex items-center gap-3 pt-7 text-sm font-bold"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} data-testid="input-promotion-active" /> Active now</label><Field label="Starts on" type="date" value={form.startsOn} onChange={(v) => setForm({ ...form, startsOn: v })} testId="input-promotion-start" /><Field label="Ends on" type="date" value={form.endsOn} onChange={(v) => setForm({ ...form, endsOn: v })} testId="input-promotion-end" />{form.scope === 'specific' && <label className="sm:col-span-2"><span className="text-sm font-bold">Selected products</span><select multiple value={form.productIds.map(String)} onChange={(e) => setForm({ ...form, productIds: Array.from(e.target.selectedOptions).map((o) => Number(o.value)) })} className="mt-2 min-h-32 w-full rounded-xl border border-input bg-card p-3 text-sm" data-testid="select-promotion-products">{(products.data ?? []).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>}</div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setOpen(false)} className="rounded-full border border-border px-5 py-3 text-sm font-bold">Cancel</button><button disabled={create.isPending || update.isPending} className="rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground" data-testid="button-save-promotion">{create.isPending || update.isPending ? 'Saving' : 'Save promotion'}</button></div></form></div>}</AdminShell>;
}

function AdminShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const access = useCurrentAdminAccess();
  const links = [{ href: '/admin', label: 'Overview', icon: LayoutGrid, permission: 'dashboard' }, { href: '/admin/orders', label: 'Orders', icon: Package, permission: 'orders' }, { href: '/admin/inventory', label: 'Inventory', icon: Warehouse, permission: 'inventory' }, { href: '/admin/customers', label: 'Customers', icon: Users, permission: 'customers' }, { href: '/admin/products', label: 'Products', icon: Store, permission: 'products' }, { href: '/admin/promotions', label: 'Promotions', icon: Sparkles, permission: 'promotions' }, { href: '/admin/shipments', label: 'Shipments', icon: Truck, permission: 'shipments' }, { href: '/admin/dates', label: 'Dates', icon: CalendarDays, permission: 'dates' }, { href: '/admin/content', label: 'Website content', icon: Pencil, permission: 'content' }, { href: '/admin/access', label: 'Access', icon: ShieldCheck, permission: 'access' }, { href: '/admin/data-protection', label: 'Data protection', icon: Database, permission: 'data-protection' }];
  const dateViewPermissions: StaffPermission[] = ['dashboard', 'shipments', 'products', 'orders'];
  const visibleLinks = links.filter((link) => link.permission === 'dates'
    ? Boolean(access.data?.permissions.some((permission) => dateViewPermissions.includes(permission)))
    : Boolean(access.data?.permissions.includes(link.permission as StaffPermission)));
  if (access.data?.permissions.includes('orders')) visibleLinks.splice(2, 0, { href: '/admin/sms', label: 'SMS messaging', icon: MessageCircle, permission: 'orders' });
  return <div className="admin-shell min-h-[100dvh] bg-background text-foreground">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-y-auto bg-secondary p-6 text-secondary-foreground md:flex">
      <Link href={visibleLinks[0]?.href ?? '/'} className="flex items-center gap-3" data-testid="admin-link-home"><BrandLogo framed className="h-14 w-[6.5rem]" /><span className="text-xs font-bold tracking-[.18em]">OPS</span></Link>
      <nav aria-label="Admin panels" className="my-8 flex flex-col gap-2">{visibleLinks.map(({ href, label, icon: Icon }) => <Link href={href} key={href} aria-current={location === href ? 'page' : undefined} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${location === href ? 'bg-primary text-primary-foreground' : 'text-secondary-foreground/75 hover:bg-secondary-foreground/10'}`} data-testid={`admin-link-${label.toLowerCase()}`}><Icon size={17} />{label}</Link>)}</nav>
      <Link href="/" className="mt-auto border-t border-secondary-foreground/15 pt-5 text-sm" data-testid="admin-link-store">View storefront</Link>
    </aside>
    <div className="min-w-0 md:pl-64">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="flex items-center justify-between gap-3"><div><p className="eyebrow text-primary">Operations desk</p><p className="text-sm font-semibold">{visibleLinks.find((link) => link.href === location)?.label ?? 'Admin'}</p></div><Link href="/" className="flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground" data-testid="admin-link-store-mobile"><LogOut size={15} /> Storefront</Link></div>
        <label className="mt-2 block md:hidden"><span className="sr-only">Choose admin panel</span><select aria-label="Choose admin panel" value={visibleLinks.some((link) => link.href === location) ? location : ''} onChange={(event) => { window.location.assign(`${basePath}${event.target.value}`); }} className="h-12 w-full rounded-xl border border-input bg-card px-3 text-sm font-semibold" data-testid="select-admin-panel"><option value="" disabled>Choose a panel</option>{visibleLinks.map((link) => <option key={link.href} value={link.href}>{link.label}</option>)}</select></label>
      </header>
      <main className="mx-auto min-w-0 max-w-7xl p-4 md:p-8">{children}{access.data?.role === 'owner' && <>{(location === '/admin' || location === '/admin/orders') && <OrderStatisticsReset />}{location === '/admin/data-protection' && <LaunchReset />}</>}</main>
    </div>
  </div>;
}
function StatCard({ label, value, detail, accent = false, onClick }: { label: string; value: string; detail?: string; accent?: boolean; onClick?: () => void }) {
  const className = `w-full rounded-2xl p-5 text-left ${accent ? 'bg-primary text-primary-foreground' : 'bg-card'} ${onClick ? 'cursor-pointer transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2' : ''}`;
  const content = <><div className="flex items-start justify-between gap-3"><p className={`eyebrow ${accent ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{label}</p>{onClick && <ArrowUpRight size={18} aria-hidden="true" />}</div><p className="serif mt-5 text-4xl font-semibold" data-testid={`stat-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</p>{detail && <p className={`mt-2 text-xs ${accent ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{detail}</p>}</>;
  return onClick ? <button type="button" onClick={onClick} className={className} data-testid={`button-stat-${label.toLowerCase().replaceAll(' ', '-')}`} aria-label={`View ${label.toLowerCase()} details`}>{content}</button> : <div className={className}>{content}</div>;
}

function ProductImageUpload({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [qualityNotice, setQualityNotice] = useState('');
  const images = (() => { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : value ? [value] : []; } catch { return value ? [value] : []; } })();
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    if (selected.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) {
      setError('Choose a JPG, PNG, or WebP image up to 10 MB.');
      return;
    }
    setUploading(true);
    setError('');
    setQualityNotice('');
    try {
      const uploadedImages: string[] = [];
      for (const file of selected) {
        // Inspect dimensions only. Upload the original file without re-encoding.
        try {
          const bitmap = await createImageBitmap(file);
          if (Math.min(bitmap.width, bitmap.height) < 1200) {
            setQualityNotice('One or more photos are small and may look soft when enlarged. For clear product photos, use originals at least 1200 pixels on the shorter side. Your original files are uploaded without compression.');
          }
          bitmap.close();
        } catch {
          // A preview decoder failure must not prevent a valid original upload.
        }
        const request = await fetch('/api/admin/storage/uploads/request-url', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }) });
        if (!request.ok) throw new Error('Could not prepare the image upload.');
        const { uploadURL, objectPath } = await request.json() as { uploadURL: string; objectPath: string };
        const uploaded = await fetch(uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!uploaded.ok) throw new Error('One of the image uploads failed.');
        uploadedImages.push(`/api/storage${objectPath}`);
      }
      onChange(JSON.stringify([...images, ...uploadedImages]));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The image upload failed.');
    } finally {
      setUploading(false);
    }
  };
  return <label className="block sm:col-span-2"><span className="text-sm font-bold">Product images</span><input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => void upload(event.target.files)} className="mt-2 block w-full rounded-xl border border-input bg-card px-3 py-3 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-xs file:font-bold file:text-secondary-foreground" data-testid="input-product-image-upload" /><p className="mt-2 text-xs text-muted-foreground">For sharp photos, choose original images at least 1200 pixels on the shorter side. JPG, PNG, or WebP up to 10 MB. Original quality is preserved.</p>{qualityNotice && <p role="status" className="mt-2 text-xs text-amber-800 dark:text-amber-300">{qualityNotice}</p>}{uploading && <p className="mt-2 text-xs text-muted-foreground">Uploading images…</p>}{error && <p className="mt-2 text-xs text-destructive">{error}</p>}<div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">{images.map((image, index) => <div key={`${image}-${index}`} className="relative aspect-square overflow-hidden rounded-lg bg-muted"><img src={image} alt={`Product preview ${index + 1}`} className="h-full w-full object-cover" /><button type="button" onClick={() => onChange(JSON.stringify(images.filter((_, imageIndex) => imageIndex !== index)))} className="absolute right-1 top-1 rounded-full bg-secondary px-2 py-1 text-[10px] font-bold text-secondary-foreground" data-testid={`button-remove-product-image-${index}`}>Remove</button></div>)}</div></label>;
}

function ProductCostFields({ price = '', currency = 'GHS', onPrice = () => undefined, onCurrency = () => undefined, prefix = 'product' }: { price?: string; currency?: string; onPrice?: (value: string) => void; onCurrency?: (value: string) => void; prefix?: string }) {
  const inventory = useListAdminInventory({ query: { queryKey: getListAdminInventoryQueryKey(), enabled: prefix === 'edit-product' } });
  const [localPrice, setLocalPrice] = useState(price);
  const [localCurrency, setLocalCurrency] = useState(currency);
  useEffect(() => {
    if (prefix !== 'edit-product' || !inventory.data) return;
    const productName = (document.querySelector('[data-testid="input-edit-product-name"]') as HTMLInputElement | null)?.value;
    const product = inventory.data.find((item) => item.name === productName);
    setLocalPrice(product?.costPrice == null ? '' : String(product.costPrice));
    setLocalCurrency(product?.costCurrency ?? 'GHS');
  }, [prefix, inventory.data]);
  const notify = (costPrice: string, costCurrency: string) => window.dispatchEvent(new CustomEvent(`ragies:${prefix}:cost`, { detail: { costPrice, costCurrency } }));
  return <><Field label="Cost price" type="number" value={localPrice} onChange={(value) => { setLocalPrice(value); onPrice(value); notify(value, localCurrency); }} testId={`input-${prefix}-cost`} /><label className="block"><span className="text-sm font-bold">Cost currency</span><select value={localCurrency} onChange={(event) => { const value = event.target.value; setLocalCurrency(value); onCurrency(value); notify(localPrice, value); }} className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-4 text-sm" data-testid={`select-${prefix}-cost-currency`}><option value="GHS">GHS</option><option value="CNY">CNY</option></select><span className="mt-1 block text-xs text-muted-foreground">Saved as part of this product. Selling price remains in GHS.</span></label></>;
}

function AdminProductForm() {
  const createProduct = useCreateProduct();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [batchError, setBatchError] = useState('');
  const blankForm = { name: '', category: '', description: '', price: '', costPrice: '', costCurrency: 'GHS' as 'GHS' | 'CNY', availability: 'ghana-stock' as 'ghana-stock' | 'pre-order', shipmentId: null as number | null, stockQuantity: '1', image: '', colors: '', sizes: '', variants: '', matrix: '', eta: '', preOrderCloseDate: '' };
  const [form, setForm] = useState(blankForm);
  useEffect(() => {
    const sync = (event: Event) => { const detail = (event as CustomEvent<{ costPrice: string; costCurrency: 'GHS' | 'CNY' }>).detail; setForm((current) => ({ ...current, ...detail })); };
    window.addEventListener('ragies:product:cost', sync);
    return () => window.removeEventListener('ragies:product:cost', sync);
  }, []);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (form.availability === 'pre-order' && !form.shipmentId) {
      setBatchError('Select an existing shipment batch or create one before saving this pre-order.');
      return;
    }
    const options = buildOptionsPayload(form);
    if (!options.ok) { setBatchError(options.errors[0]); return; }
    setBatchError('');
    createProduct.mutate({
      data: {
        name: form.name,
        category: form.category,
        description: form.description,
        price: Number(form.price),
        ...(form.costPrice ? { costPrice: Number(form.costPrice), costCurrency: form.costCurrency } : {}),
        availability: form.availability,
        shipmentId: form.availability === 'pre-order' ? form.shipmentId : null,
        stockQuantity: options.data.stockQuantity,
        images: (() => { try { const parsed = JSON.parse(form.image || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return form.image ? [form.image] : []; } })(),
        colors: options.data.colors,
        sizes: options.data.sizes,
        variants: options.data.variants,
        eta: form.eta || null,
        preOrderCloseDate: form.preOrderCloseDate || null,
      },
    }, {
      onSuccess: () => { client.invalidateQueries({ queryKey: ['/api/products'] }); client.invalidateQueries({ queryKey: getListAdminInventoryQueryKey() }); client.invalidateQueries({ queryKey: getListShipmentsQueryKey() }); client.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() }); client.invalidateQueries({ queryKey: getGetAdminEtaRemindersQueryKey() }); setOpen(false); setForm(blankForm); },
    });
  };
  return <div className="mt-4 rounded-2xl bg-card p-5 sm:p-7"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow text-muted-foreground">Catalog</p><h2 className="serif mt-2 text-2xl font-semibold">Add a piece</h2></div><button onClick={() => setOpen(!open)} className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2.5 text-sm font-bold text-secondary-foreground" data-testid="button-toggle-add-product">{open ? <X size={15} /> : <Plus size={15} />}{open ? 'Close' : 'New product'}</button></div>{open && <form onSubmit={submit} className="mt-6 grid gap-4 border-t border-border pt-6 sm:grid-cols-2"><Field label="Product name" value={form.name} onChange={(value) => set('name', value)} required testId="input-product-name" /><Field label="Category" value={form.category} onChange={(value) => set('category', value)} required testId="input-product-category" /><Field label="Price (GHS)" type="number" value={form.price} onChange={(value) => set('price', value)} required testId="input-product-price" /><div className="sm:col-span-2"><AvailabilityBatchControl availability={form.availability} shipmentId={form.shipmentId} onChange={(availability, shipmentId) => { setBatchError(''); setForm((current) => ({ ...current, availability, shipmentId })); }} testId="new-product-availability" />{batchError && <p role="alert" className="mt-2 text-sm text-destructive">{batchError}</p>}</div><Field label="Image URL (optional)" value={form.image} onChange={(value) => set('image', value)} testId="input-product-image" /><label className="sm:col-span-2"><span className="text-sm font-bold">Description</span><textarea value={form.description} onChange={(event) => set('description', event.target.value)} required rows={3} className="mt-2 w-full resize-none rounded-xl border border-input bg-background p-4 text-sm" data-testid="input-product-description" /></label><ProductOptionsFields prefix="product" value={form} onChange={(next) => { setBatchError(''); setForm((current) => ({ ...current, ...next })); }} />{form.availability === 'pre-order' && <><InheritedClosingField shipmentId={form.shipmentId} rawDate={form.preOrderCloseDate} onChange={(value) => set('preOrderCloseDate', value)} testId="input-product-close-date" /><InheritedEtaField shipmentId={form.shipmentId} rawEta={form.eta} onChange={(value) => set('eta', value)} testId="input-product-eta" /></>}<div className="sm:col-span-2"><button disabled={createProduct.isPending} className="rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60" data-testid="button-create-product">{createProduct.isPending ? 'Saving product…' : 'Add to catalog'}</button>{createProduct.isError && <p className="mt-3 text-sm text-destructive" data-testid="status-create-product-error">{apiErrorMessage(createProduct.error, 'Could not save this product. Check the fields and try again.')}</p>}</div></form>}</div>;
}
function Admin() {
  const [salesOpen, setSalesOpen] = useState(false);
  const [salesSearchDraft, setSalesSearchDraft] = useState('');
  const [salesSearch, setSalesSearch] = useState('');
  const dashboard = useGetAdminDashboard({ query: { queryKey: getGetAdminDashboardQueryKey() } });
  const salesOrders = useListAdminOrders(undefined, { query: { queryKey: getListAdminOrdersQueryKey(), enabled: salesOpen } });
  const summary = dashboard.data as DashboardSummary | undefined;
  const salesRows = useMemo(() => (salesOrders.data ?? []).flatMap((order) => order.items.map((item, index) => ({ order, item, index }))), [salesOrders.data]);
  const filteredSalesRows = useMemo(() => {
    const search = salesSearch.trim().toLowerCase();
    if (!search) return salesRows;
    return salesRows.filter(({ order, item }) => item.productName.toLowerCase().includes(search) || order.customerName.toLowerCase().includes(search));
  }, [salesRows, salesSearch]);
  return <AdminShell>{dashboard.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1,2,3,4].map((item) => <div key={item} className="skeleton h-36 rounded-2xl" />)}</div> : dashboard.isError || !summary ? <QueryError retry={() => dashboard.refetch()} /> : <><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow text-primary">Overview</p><h1 className="serif mt-2 text-4xl font-semibold">The pulse of Ragies.</h1></div><p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat('en-GH', { dateStyle: 'full' }).format(new Date())}</p></div><div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Total sales" value={money(summary.totalSales)} detail="Click to view every item sold" accent onClick={() => setSalesOpen(true)} /><StatCard label="Orders received" value={String(summary.ordersReceived)} detail="Across every status" /><StatCard label="Paid orders" value={String(summary.paidOrders)} detail="Payment complete" /><StatCard label="Outstanding balance" value={money(summary.outstandingBalance)} detail="Still to collect" /></div><div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_.7fr]"><div className="rounded-2xl bg-card p-5 sm:p-7"><div className="flex items-center justify-between"><div><p className="eyebrow text-muted-foreground">Recent orders</p><h2 className="serif mt-2 text-2xl font-semibold">Keep things moving.</h2></div><Link href="/admin/orders" className="text-sm font-bold text-primary" data-testid="admin-link-all-orders">View all</Link></div><div className="mt-6 divide-y divide-border">{(summary.recentOrders ?? []).slice(0, 6).map((order) => <OrderRow key={order.id} order={order} compact />)}{!summary.recentOrders?.length && <p className="py-10 text-center text-sm text-muted-foreground">No orders yet.</p>}</div></div><div className="rounded-2xl bg-secondary p-5 text-secondary-foreground sm:p-7"><p className="eyebrow text-accent">Inventory note</p><p className="serif mt-4 text-4xl">{summary.availableStock}</p><p className="mt-1 text-sm text-secondary-foreground/65">pieces currently available in Ghana</p><div className="mt-9 border-t border-secondary-foreground/15 pt-5"><p className="text-xs text-secondary-foreground/55">Pre-order sales</p><p className="mt-1 text-xl font-bold">{money(summary.preOrderSales)}</p></div><Link href="/admin/shipments" className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-accent" data-testid="admin-link-shipments-card">See shipment batches <ArrowRight size={15} /></Link></div></div><AdminProductForm />{salesOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-secondary/60 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="sales-detail-title"><div className="max-h-[92dvh] w-full max-w-5xl overflow-hidden rounded-t-3xl bg-background shadow-2xl sm:rounded-3xl"><div className="flex items-start justify-between border-b border-border p-5 sm:p-7"><div><p className="eyebrow text-primary">Sales detail</p><h2 id="sales-detail-title" className="serif mt-2 text-3xl font-semibold">Every item bought</h2><p className="mt-2 text-sm text-muted-foreground">Customer names and quantities from all active orders.</p></div><button type="button" onClick={() => setSalesOpen(false)} className="rounded-full border border-border p-2" aria-label="Close sales details" data-testid="button-close-sales-detail"><X size={18} /></button></div><div className="max-h-[68dvh] overflow-auto p-5 sm:p-7"><form onSubmit={(event) => { event.preventDefault(); setSalesSearch(salesSearchDraft); }} className="mb-5 flex gap-2"><label className="relative flex-1"><span className="sr-only">Search products or customers</span><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={17} /><input value={salesSearchDraft} onChange={(event) => setSalesSearchDraft(event.target.value)} placeholder="Search product or customer name" className="h-11 w-full rounded-xl border border-input bg-card pl-10 pr-4 text-sm outline-none focus:border-primary" data-testid="input-sales-search" /></label><button type="submit" className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground" data-testid="button-sales-search"><Search size={16} /> Search</button>{salesSearch && <button type="button" onClick={() => { setSalesSearchDraft(''); setSalesSearch(''); }} className="h-11 rounded-xl border border-border px-4 text-sm font-bold">Clear</button>}</form>{salesOrders.isLoading ? <div className="space-y-3">{[1,2,3,4].map((item) => <div key={item} className="skeleton h-14 rounded-xl" />)}</div> : salesOrders.isError ? <QueryError retry={() => salesOrders.refetch()} /> : !salesOrders.data?.length ? <p className="py-12 text-center text-sm text-muted-foreground">No sales have been recorded yet.</p> : !filteredSalesRows.length ? <div className="rounded-2xl border border-dashed border-border py-12 text-center"><Search className="mx-auto text-primary" /><p className="mt-3 font-bold">No matching sales found.</p><p className="mt-1 text-sm text-muted-foreground">Try another product or customer name.</p></div> : <div className="overflow-hidden rounded-2xl border border-border"><div className="hidden grid-cols-[1.3fr_1fr_100px_120px] gap-4 bg-muted px-4 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground sm:grid"><span>Item</span><span>Customer</span><span className="text-right">Quantity</span><span className="text-right">Order</span></div><div className="divide-y divide-border">{filteredSalesRows.map(({ order, item, index }) => <div key={`${order.id}-${index}`} className="grid gap-2 px-4 py-4 sm:grid-cols-[1.3fr_1fr_100px_120px] sm:items-center sm:gap-4" data-testid={`sales-item-${order.id}-${index}`}><div><p className="font-bold">{item.productName}</p>{(item.color || item.size) && <p className="mt-1 text-xs text-muted-foreground">{[item.color, item.size].filter(Boolean).join(' · ')}</p>}</div><div><p className="text-xs text-muted-foreground sm:hidden">Customer</p><p className="text-sm font-semibold">{order.customerName}</p></div><div className="flex items-center justify-between sm:block sm:text-right"><p className="text-xs text-muted-foreground sm:hidden">Quantity</p><p className="font-bold">{item.quantity}</p></div><div className="flex items-center justify-between sm:block sm:text-right"><p className="text-xs text-muted-foreground sm:hidden">Order</p><p className="text-xs font-semibold">{order.orderNumber}</p></div></div>)}</div></div>}</div></div></div>}</>}</AdminShell>;
}
const ADMIN_ORDER_STATUSES = ['New Order', 'Awaiting Payment', 'Processing', 'In China', 'Shipped', 'Arrived in Ghana', 'Packing', 'Ready for Pickup', 'Out for Delivery', 'Completed', 'Cancelled'];

function OrderRow({ order, compact = false, onUpdate, onSelect }: { order: Order; compact?: boolean; onUpdate?: (order: Order) => void; onSelect?: (order: Order) => void }) {
  return <div className={`flex items-center gap-3 py-4 ${compact ? '' : 'px-4'} ${onSelect ? 'cursor-pointer transition-colors hover:bg-muted/40' : ''}`} onClick={() => onSelect?.(order)} data-testid={`row-order-${order.id}`}><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{order.customerName.split(' ').map((name) => name[0]).slice(0,2).join('')}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{order.customerName}</p><p className="mt-0.5 text-xs text-muted-foreground">{order.orderNumber} · {shortDate(order.createdAt)}</p></div><div className="hidden text-right sm:block"><p className="text-sm font-semibold">{money(order.totalAmount)}</p><p className="text-xs text-muted-foreground">{order.paymentStatus} · {money(order.balance)} due</p></div>{onUpdate ? <select value={order.status} onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdate({ ...order, status: event.target.value as Order['status'] })} className="max-w-[150px] rounded-lg border border-input bg-background px-2 py-2 text-xs font-semibold" aria-label={`Update ${order.orderNumber} status`} data-testid={`select-order-status-${order.id}`}>{ADMIN_ORDER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select> : <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase">{order.status}</span>}</div>;
}

type ManualOrderLine = { productId: string; quantity: string; color: string; size: string };

function AdminOrderForm({ onCreated }: { onCreated: (order: Order) => void }) {
  const access = useCurrentAdminAccess();
  const products = useListProducts({ sort: 'featured' }, { query: { queryKey: getListProductsQueryKey({ sort: 'featured' }) } });
  const shipments = useListProductBatches({ query: { queryKey: getListProductBatchesQueryKey() } });
  const create = useCreateAdminOrder();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customerName: '', phone: '', whatsapp: '', address: '', city: 'Accra', fulfillmentMethod: 'delivery' as AdminOrderInput['fulfillmentMethod'], paymentMethod: 'mobile-money', amountPaid: '0', status: 'New Order', notes: '', shipmentName: '' });
  const [lines, setLines] = useState<ManualOrderLine[]>([{ productId: '', quantity: '1', color: '', size: '' }]);
  useEffect(() => {
    const formElement = document.querySelector('[data-testid="button-manual-fulfillment-pickup"]')?.closest('form');
    const address = formElement?.querySelector('textarea');
    if (address) {
      const wrapper = address.parentElement;
      if (wrapper) wrapper.hidden = form.fulfillmentMethod === 'pickup';
      address.toggleAttribute('required', form.fulfillmentMethod === 'delivery');
    }
  }, [form.fulfillmentMethod, open]);
  if (!access.data?.permissions.includes('payments')) return null;
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const updateLine = (index: number, key: keyof ManualOrderLine, value: string) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const items = lines.filter((line) => line.productId).map((line) => ({ productId: Number(line.productId), quantity: Math.max(1, Number(line.quantity) || 1), color: line.color || null, size: line.size || null }));
    if (!items.length) return;
    create.mutate({ data: { ...form, phone: normalizeContactPhone(form.phone) ?? form.phone.trim(), fulfillmentMethod: form.fulfillmentMethod ?? 'delivery', whatsapp: form.whatsapp.trim() ? normalizeContactPhone(form.whatsapp) ?? form.whatsapp.trim() : null, notes: form.notes || null, shipmentName: form.shipmentName || null, amountPaid: Number(form.amountPaid) || 0, items } }, {
      onSuccess: (order) => {
        onCreated(order);
        setOpen(false);
        setForm({ customerName: '', phone: '', whatsapp: '', address: '', city: 'Accra', fulfillmentMethod: 'delivery', paymentMethod: 'mobile-money', amountPaid: '0', status: 'New Order', notes: '', shipmentName: '' });
        setLines([{ productId: '', quantity: '1', color: '', size: '' }]);
      },
    });
  };
  return <div className="mt-5 rounded-2xl bg-card p-5 sm:p-7"><div className="flex items-center justify-between gap-4"><div><p className="eyebrow text-muted-foreground">Manual entry</p><h2 className="serif mt-2 text-2xl font-semibold">Add an order</h2></div><button onClick={() => setOpen(!open)} className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2.5 text-sm font-bold text-secondary-foreground"><Plus size={15} /> {open ? 'Close' : 'New order'}</button></div>{open && <form onSubmit={submit} className="mt-6 space-y-5 border-t border-border pt-6"><div className="grid gap-4 sm:grid-cols-2"><Field label="Customer name" value={form.customerName} onChange={(value) => update('customerName', value)} required testId="input-manual-customer-name" /><Field label="Phone" type="tel" value={form.phone} onChange={(value) => update('phone', value)} required testId="input-manual-phone" /><Field label="WhatsApp (optional)" type="tel" value={form.whatsapp} onChange={(value) => update('whatsapp', value)} testId="input-manual-whatsapp" /><Field label="City" value={form.city} onChange={(value) => update('city', value)} required testId="input-manual-city" /></div><label className="block"><span className="text-sm font-bold">Address</span><textarea value={form.address} onChange={(event) => update('address', event.target.value)} required rows={2} className="mt-2 w-full rounded-xl border border-input bg-background p-4 text-sm" /></label><div className="space-y-3"><div className="flex items-center justify-between"><p className="text-sm font-bold">Products</p><button type="button" onClick={() => setLines((current) => [...current, { productId: '', quantity: '1', color: '', size: '' }])} className="text-xs font-bold text-primary">+ Add another</button></div>{lines.map((line, index) => <div key={index} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_90px_1fr_1fr_auto]"><select value={line.productId} onChange={(event) => updateLine(index, 'productId', event.target.value)} className="h-11 rounded-lg border border-input bg-background px-3 text-sm" required><option value="">Choose product</option>{(products.data ?? []).map((product) => <option key={product.id} value={product.id}>{product.name} · {money(product.price)}</option>)}</select><input type="number" min="1" value={line.quantity} onChange={(event) => updateLine(index, 'quantity', event.target.value)} className="h-11 rounded-lg border border-input bg-background px-3 text-sm" aria-label="Quantity" /><input value={line.color} onChange={(event) => updateLine(index, 'color', event.target.value)} placeholder="Colour" className="h-11 rounded-lg border border-input bg-background px-3 text-sm" /><input value={line.size} onChange={(event) => updateLine(index, 'size', event.target.value)} placeholder="Size" className="h-11 rounded-lg border border-input bg-background px-3 text-sm" />{lines.length > 1 && <button type="button" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} className="self-center text-muted-foreground"><X size={16} /></button>}</div>)}</div><div className="grid gap-4 sm:grid-cols-3"><label className="block"><span className="text-sm font-bold">Payment method</span><select value={form.paymentMethod} onChange={(event) => update('paymentMethod', event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-4 text-sm"><option value="mobile-money">Mobile money</option><option value="cash">Cash</option><option value="bank-transfer">Bank transfer</option><option value="pay-on-delivery">Pay on delivery</option></select></label><Field label="Amount paid (GHS)" type="number" value={form.amountPaid} onChange={(value) => update('amountPaid', value)} testId="input-manual-amount-paid" /><label className="block"><span className="text-sm font-bold">Order status</span><select value={form.status} onChange={(event) => update('status', event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-4 text-sm">{ADMIN_ORDER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select></label></div><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="text-sm font-bold">Shipment/batch (optional)</span><select value={form.shipmentName} onChange={(event) => update('shipmentName', event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-4 text-sm" data-testid="select-manual-shipment"><option value="">No batch assigned</option>{(shipments.data ?? []).map((shipment) => <option key={shipment.id} value={shipment.name}>{shipment.name}</option>)}</select>{shipments.isError && <span className="mt-1 block text-xs text-destructive">Shipment list unavailable. Use the shipment desk to review batches.</span>}</label><label className="block"><span className="text-sm font-bold">Notes</span><textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} rows={2} className="mt-2 w-full rounded-xl border border-input bg-background p-3 text-sm" /></label></div><button disabled={create.isPending} className="rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">{create.isPending ? 'Creating order…' : 'Create order'}</button>{create.isError && <p className="text-sm text-destructive">Could not create the order. Check the customer and product details.</p>}</form>}</div>;
}

function AdminOrderDetail({ order, onClose, onSaved, onDeleted }: { order: Order; onClose: () => void; onSaved: (order: Order) => void; onDeleted: () => void }) {
  const update = useUpdateAdminOrder();
  const shipments = useListProductBatches({ query: { queryKey: getListProductBatchesQueryKey() } });
  const remove = useDeleteAdminOrder();
  const [form, setForm] = useState({ customerName: order.customerName, phone: order.phone, whatsapp: order.whatsapp ?? '', address: order.address, city: order.city, paymentMethod: order.paymentMethod, amountPaid: String(order.amountPaid), paymentStatus: order.paymentStatus, status: order.status, shipmentName: order.shipmentName ?? '', notes: order.notes ?? '' });
  useEffect(() => {
    setForm({ customerName: order.customerName, phone: order.phone, whatsapp: order.whatsapp ?? '', address: order.address, city: order.city, paymentMethod: order.paymentMethod, amountPaid: String(order.amountPaid), paymentStatus: order.paymentStatus, status: order.status, shipmentName: order.shipmentName ?? '', notes: order.notes ?? '' });
  }, [order]);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const save = (event: FormEvent) => {
    event.preventDefault();
    const { paymentStatus: _serverPaymentStatus, ...draft } = form;
    update.mutate({ id: order.id, data: orderEditorPatch(order, {
      ...draft,
      phone: normalizeContactPhone(draft.phone) ?? draft.phone.trim(),
      whatsapp: draft.whatsapp.trim() ? normalizeContactPhone(draft.whatsapp) ?? draft.whatsapp.trim() : '',
    }) }, { onSuccess: onSaved });
  };
  const confirmDelete = () => {
    if (window.confirm(`Move ${order.orderNumber} to the recycle bin? You can restore it later.`)) remove.mutate({ id: order.id }, { onSuccess: onDeleted });
  };
  const message = form.status === 'Ready for Pickup'
    ? `Hi ${order.customerName}, good news — your Ragies Imports order ${order.orderNumber} has arrived in Ghana and is ready for pickup. Please let us know when you would like to collect it.`
    : `Hi ${order.customerName}, a quick update from Ragies Imports: order ${order.orderNumber} is now ${form.status}. We will keep you posted on the next step.`;
  const { whatsappHref, smsHref } = orderContactLinks(order.phone, order.whatsapp, message);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-secondary/50 p-0 sm:items-center sm:p-6">
      <div className="max-h-[95dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-background p-5 shadow-2xl sm:rounded-3xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow text-primary">Order detail</p>
            <h2 className="serif mt-2 text-3xl font-semibold">{order.orderNumber}</h2>
            <span className="mt-2 inline-flex rounded-full bg-accent px-3 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-accent-foreground">{order.paymentStatus === 'paid' ? 'Paid' : 'Partially paid'}</span>
            <p className="mt-1 text-sm text-muted-foreground">{date(order.createdAt)} · {order.items.length} product line(s)</p>
          </div>
          <button onClick={onClose} className="rounded-full border border-border p-2" aria-label="Close order detail"><X size={17} /></button>
        </div>
        <div className="mt-6 rounded-2xl bg-card p-5">
          <p className="eyebrow text-muted-foreground">Products ordered</p>
          <div className="mt-4 divide-y divide-border">
            {order.items.map((item) => <div key={`${item.productId}-${item.color}-${item.size}-${item.variantType}`} className="flex items-center justify-between gap-4 py-3 text-sm"><div><p className="font-semibold">{item.productName}</p><p className="text-xs text-muted-foreground">{lineSelection(item)} · Qty: {item.quantity} × {money(item.unitPrice)}</p></div><p className="font-bold">{money(item.unitPrice * item.quantity)}</p></div>)}
          </div>
          <div className="mt-4 flex justify-between border-t border-border pt-4 text-sm"><span>Total</span><strong>{money(order.totalAmount)}</strong></div>
        </div>
        <OrderFinance order={order} />
        <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Customer name" value={form.customerName} onChange={(value) => set('customerName', value)} required testId="input-edit-customer-name" />
          <Field label="Phone" type="tel" value={form.phone} onChange={(value) => set('phone', value)} required testId="input-edit-phone" />
          <Field label="WhatsApp" type="tel" value={form.whatsapp} onChange={(value) => set('whatsapp', value)} testId="input-edit-whatsapp" />
          <Field label="City" value={form.city} onChange={(value) => set('city', value)} required testId="input-edit-city" />
          <label className="block sm:col-span-2"><span className="text-sm font-bold">Address</span><textarea value={form.address} onChange={(event) => set('address', event.target.value)} required rows={2} className="mt-2 w-full rounded-xl border border-input bg-card p-4 text-sm" /></label>
          <label className="block"><span className="text-sm font-bold">Order status</span><select value={form.status} onChange={(event) => set('status', event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-sm">{ADMIN_ORDER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
          <label className="block"><span className="text-sm font-bold">Payment status (automatic)</span><select value={form.paymentStatus} disabled className="mt-2 h-12 w-full rounded-xl border border-input bg-muted px-4 text-sm opacity-75"><option value="partial">Partially paid</option><option value="paid">Paid</option></select></label>
          <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:col-span-2" aria-labelledby="customer-notification-title">
            <p id="customer-notification-title" className="text-sm font-bold">Customer notification</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Review the prefilled message, then finish sending it in WhatsApp or SMS. Ragies Imports does not send it automatically.</p>
            <p className="mt-3 rounded-xl bg-background p-3 text-sm leading-6" data-testid="text-notification-preview">{message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={whatsappHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-xs font-bold" data-testid="link-open-whatsapp"><MessageCircle size={14} /> Open WhatsApp</a>
              <a href={smsHref} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-xs font-bold" data-testid="link-open-sms"><Send size={14} /> Open SMS</a>
            </div>
          </section>
          <Field label="Amount paid (GHS)" type="number" value={form.amountPaid} onChange={(value) => set('amountPaid', value)} testId="input-edit-amount-paid" />
          <label className="block"><span className="text-sm font-bold">Shipment/batch</span><select value={form.shipmentName} onChange={(event) => set('shipmentName', event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-4 text-sm" data-testid="select-edit-shipment"><option value="">No batch assigned</option>{form.shipmentName && !shipments.data?.some((shipment) => shipment.name === form.shipmentName) && <option value={form.shipmentName}>{form.shipmentName} (current)</option>}{(shipments.data ?? []).map((shipment) => <option key={shipment.id} value={shipment.name}>{shipment.name} · {date(shipment.expectedArrival)}</option>)}</select>{shipments.isError && <span className="mt-1 block text-xs text-destructive">Shipment batches could not be loaded; existing manual assignment is preserved.</span>}</label>
          <label className="block sm:col-span-2"><span className="text-sm font-bold">Notes</span><textarea value={form.notes} onChange={(event) => set('notes', event.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-input bg-card p-4 text-sm" /></label>
          <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
            <div className="flex gap-2"><button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-bold"><Printer size={15} /> Print</button><button type="button" onClick={confirmDelete} className="inline-flex items-center gap-2 rounded-full border border-destructive/30 px-4 py-2.5 text-sm font-bold text-destructive"><Trash2 size={15} /> Move to bin</button></div>
            <button disabled={update.isPending} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">{update.isPending ? 'Saving…' : 'Save changes'}</button>
          </div>
          {update.isError && <p className="text-sm text-destructive sm:col-span-2">Could not save this order. Check the values and try again.</p>}
        </form>
      </div>
    </div>
  );
}

function AdminOrders() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [availability, setAvailability] = useState('');
  const [product, setProduct] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showTrash, setShowTrash] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const params = useMemo(() => ({ search: search || undefined, status: status || undefined, paymentStatus: paymentStatus || undefined, availability: availability || undefined, product: product || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }), [search, status, paymentStatus, availability, product, dateFrom, dateTo]);
  const orders = useListAdminOrders(params, { query: { queryKey: getListAdminOrdersQueryKey(params), enabled: !showTrash } });
  const trash = useListDeletedAdminOrders({ query: { queryKey: getListDeletedAdminOrdersQueryKey(), enabled: showTrash } });
  const update = useUpdateAdminOrder();
  const restore = useRestoreAdminOrder();
  const client = useQueryClient();
  const refresh = () => {
    void refreshOrderViews(client);
  };
  const saveStatus = (order: Order) => update.mutate({ id: order.id, data: { status: order.status } }, { onSuccess: refresh });
  const activeOrders = showTrash ? (trash.data ?? []) : (orders.data ?? []);
  const exportOrders = () => {
    const header = ['Order', 'Customer', 'Phone', 'City', 'Products', 'Items (size / colour / qty)', 'Total', 'Paid', 'Balance', 'Payment status', 'Status', 'Created'];
    const rows = activeOrders.map((order) => [order.orderNumber, order.customerName, order.phone, order.city, order.items.map((item) => `${item.productName} x${item.quantity}`).join('; '), order.items.map((item) => `${item.productName} | Size: ${item.size ?? ''} | Colour: ${item.color ?? ''} | Type: ${item.variantType ?? ''} | Qty: ${item.quantity}`).join('; '), order.totalAmount, order.amountPaid, order.balance, order.paymentStatus, order.status, order.createdAt]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `ragies-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return <AdminShell><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow text-primary">All orders</p><h1 className="serif mt-2 text-4xl font-semibold">Make every handoff count.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Create, edit, record payments, print, export, and recover orders from one place.</p></div><span className="text-sm text-muted-foreground">{activeOrders.length} orders</span></div><AdminOrderForm onCreated={(order) => { refresh(); setSelectedOrder(order); }} /><div className="mt-6 rounded-2xl bg-card p-4 sm:p-5"><div className="grid gap-3 lg:grid-cols-[1fr_180px_190px_170px_170px]"><label className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, order number, phone" className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-4 text-sm outline-none focus:border-primary" data-testid="input-admin-order-search" /></label><input value={product} onChange={(event) => setProduct(event.target.value)} placeholder="Product name" className="h-11 rounded-xl border border-input bg-background px-4 text-sm outline-none focus:border-primary" /><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-11 rounded-xl border border-input bg-background px-4 text-sm outline-none" data-testid="select-admin-order-filter"><option value="">All statuses</option>{ADMIN_ORDER_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)} className="h-11 rounded-xl border border-input bg-background px-4 text-sm outline-none"><option value="">All payments</option><option value="partial">Partially paid</option><option value="paid">Paid</option></select><select value={availability} onChange={(event) => setAvailability(event.target.value)} className="h-11 rounded-xl border border-input bg-background px-4 text-sm outline-none"><option value="">All availability</option><option value="ghana-stock">Ready in Ghana</option><option value="pre-order">Pre-order</option></select></div><div className="mt-3 flex flex-wrap items-center gap-3"><label className="text-xs font-bold text-muted-foreground">From <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="ml-1 h-10 rounded-lg border border-input bg-background px-3 text-sm font-normal text-foreground" /></label><label className="text-xs font-bold text-muted-foreground">To <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="ml-1 h-10 rounded-lg border border-input bg-background px-3 text-sm font-normal text-foreground" /></label><button onClick={() => { setShowTrash(!showTrash); setSelectedOrder(null); }} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-bold">{showTrash ? <><X size={14} /> Active orders</> : <><Trash2 size={14} /> Recycle bin</>}</button><button onClick={exportOrders} disabled={!activeOrders.length} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-bold disabled:opacity-40"><Download size={14} /> Export CSV</button></div></div><div className="mt-5 overflow-hidden rounded-2xl bg-card"><div className="flex items-center justify-between border-b border-border px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">{showTrash ? 'Recycle bin' : 'Active orders'}</p><p className="text-xs text-muted-foreground">Click an order for details</p></div>{(showTrash ? trash.isError : orders.isError) ? <div className="p-5"><QueryError retry={() => showTrash ? trash.refetch() : orders.refetch()} /></div> : (showTrash ? trash.isLoading : orders.isLoading) ? <div className="space-y-4 p-5">{[1,2,3,4].map((item) => <div key={item} className="skeleton h-12 rounded-lg" />)}</div> : !activeOrders.length ? <div className="p-16 text-center"><Filter className="mx-auto text-primary" /><p className="serif mt-3 text-xl">{showTrash ? 'The recycle bin is empty.' : 'No orders in this view.'}</p></div> : <div className="divide-y divide-border">{activeOrders.map((order) => showTrash ? <div key={order.id} className="flex items-center gap-3 px-4"><div className="flex-1"><OrderRow order={order} compact /></div><button onClick={() => restore.mutate({ id: order.id }, { onSuccess: refresh })} className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-2 text-xs font-bold"><RotateCcw size={14} /> Restore</button></div> : <OrderRow key={order.id} order={order} onUpdate={saveStatus} onSelect={setSelectedOrder} />)}</div>}</div>{selectedOrder && !showTrash && <AdminOrderDetail order={selectedOrder} onClose={() => setSelectedOrder(null)} onSaved={(saved) => { setSelectedOrder(saved); refresh(); }} onDeleted={() => { setSelectedOrder(null); refresh(); }} />}</AdminShell>;
}

function AdminProducts() {
  const products = useListAdminInventory({ query: { queryKey: getListAdminInventoryQueryKey() } });
  const update = useUpdateProduct();
  const archive = useArchiveProduct();
  const client = useQueryClient();
  const [selected, setSelected] = useState<Product | null>(null);
  const [draft, setDraft] = useState({ name: '', category: '', description: '', price: '', costPrice: '', costCurrency: 'GHS' as 'GHS' | 'CNY', stockQuantity: '', availability: 'ghana-stock', images: [] as string[], image: '', colors: '', sizes: '', variants: '', featured: false, preOrderCloseDate: '', eta: '' });
  useEffect(() => {
    const sync = (event: Event) => { const detail = (event as CustomEvent<{ costPrice: string; costCurrency: 'GHS' | 'CNY' }>).detail; setDraft((current) => ({ ...current, ...detail })); };
    window.addEventListener('ragies:edit-product:cost', sync);
    return () => window.removeEventListener('ragies:edit-product:cost', sync);
  }, []);
  useEffect(() => { if (selected) setDraft({ name: selected.name, category: selected.category, description: selected.description, price: String(selected.price), costPrice: selected.costPrice == null ? '' : String(selected.costPrice), costCurrency: selected.costCurrency ?? 'GHS', stockQuantity: String(selected.stockQuantity), availability: selected.availability, images: selected.images, image: selected.images[0] ?? '', colors: selected.colors.join(', '), sizes: selected.sizes.join(', '), variants: selected.variants.map((variant) => `${variant.name}: ${variant.colors.join(', ')}`).join('\n'), featured: selected.featured, preOrderCloseDate: selected.preOrderCloseDate ?? '', eta: selected.eta ?? '' }); }, [selected]);
  const refresh = () => { void client.invalidateQueries({ queryKey: getListAdminInventoryQueryKey() }); void client.invalidateQueries({ queryKey: getListProductsQueryKey({ sort: 'newest' }) }); };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    let preOrderCloseDate: string | null = null;
    let eta: string | null = null;
    if (draft.availability === 'pre-order') {
      const closeDate = window.prompt('Pre-order closing date (YYYY-MM-DD). Leave blank to use the shipment batch date. Use today to close now, or a future date to reopen.', draft.preOrderCloseDate);
      if (closeDate === null) return;
      const expectedArrival = window.prompt('Expected arrival date (YYYY-MM-DD). Customers with this item will see ETA changes.', draft.eta);
      if (expectedArrival === null) return;
      preOrderCloseDate = closeDate.trim() || null;
      eta = expectedArrival.trim() || null;
    }
    let editedImages = draft.images;
    try { const parsed = JSON.parse(draft.image || '[]'); if (Array.isArray(parsed)) editedImages = parsed; } catch { editedImages = draft.image ? [draft.image, ...draft.images.slice(1)] : draft.images; }
    const variants = draft.variants.split('\n').map((line) => { const [name, colors] = line.split(':'); return { name: name?.trim(), colors: (colors ?? '').split(',').map((value) => value.trim()).filter(Boolean) }; }).filter((variant) => variant.name) as { name: string; colors: string[] }[];
    update.mutate({ id: selected.id, data: { name: draft.name, category: draft.category, description: draft.description, price: Number(draft.price), ...(draft.costPrice ? { costPrice: Number(draft.costPrice), costCurrency: draft.costCurrency } : { costPrice: null }), stockQuantity: Number(draft.stockQuantity), availability: draft.availability as Product['availability'], images: editedImages, colors: draft.colors.split(',').map((value) => value.trim()).filter(Boolean), sizes: draft.sizes.split(',').map((value) => value.trim()).filter(Boolean), variants, featured: draft.featured, preOrderCloseDate, eta } }, { onSuccess: () => { refresh(); setSelected(null); } });
  };
  const archiveProduct = (product: Product) => { if (window.confirm(`Hide ${product.name} from the storefront?`)) archive.mutate({ id: product.id }, { onSuccess: refresh }); };
  return <AdminShell><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow text-primary">Catalog</p><h1 className="serif mt-2 text-4xl font-semibold">Products and stock.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Add products, adjust stock, update pricing and variations, or hide items from the storefront.</p></div><span className="text-sm text-muted-foreground">{products.data?.length ?? 0} active products</span></div><AdminProductForm /><div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{products.isLoading ? [1,2,3].map((item) => <div key={item} className="skeleton h-72 rounded-2xl" />) : products.data?.map((product) => <div key={product.id} className="overflow-hidden rounded-2xl bg-card"><div className="aspect-[16/9] bg-muted">{product.images[0] && <img src={product.images[0]} alt="" className="h-full w-full object-cover" />}</div><div className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="eyebrow text-muted-foreground">{product.category}</p><h2 className="mt-1 font-bold">{product.name}</h2></div><p className="font-bold">{money(product.price)}</p></div><div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-background p-3 text-xs"><div><p className="text-muted-foreground">Stock</p><p className="mt-1 font-bold">{product.stockQuantity}</p></div><div><p className="text-muted-foreground">Availability</p><p className="mt-1 font-bold">{product.availability === 'ghana-stock' ? 'Ready in Ghana' : 'Pre-order'}</p></div></div><div className="mt-4 flex gap-2"><button onClick={() => setSelected(product)} className="flex-1 rounded-full bg-secondary px-4 py-2.5 text-xs font-bold text-secondary-foreground">Edit / adjust stock</button><button onClick={() => archiveProduct(product)} className="rounded-full border border-destructive/30 p-2.5 text-destructive"><Trash2 size={15} /></button></div></div></div>)}</div>{selected && <div className="fixed inset-0 z-50 flex items-end justify-center bg-secondary/50 sm:items-center sm:p-6"><form onSubmit={save} className="max-h-[95dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-background p-6 shadow-2xl sm:rounded-3xl"><div className="flex items-center justify-between"><div><p className="eyebrow text-primary">Edit product</p><h2 className="serif mt-2 text-3xl">{selected.name}</h2></div><button type="button" onClick={() => setSelected(null)} className="rounded-full border border-border p-2"><X size={17} /></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><Field label="Name" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} required testId="input-edit-product-name" /><Field label="Category" value={draft.category} onChange={(value) => setDraft({ ...draft, category: value })} required testId="input-edit-product-category" /><Field label="Price (GHS)" type="number" value={draft.price} onChange={(value) => setDraft({ ...draft, price: value })} required testId="input-edit-product-price" /><Field label="Stock quantity" type="number" value={draft.stockQuantity} onChange={(value) => setDraft({ ...draft, stockQuantity: value })} required testId="input-edit-product-stock" /><label><span className="text-sm font-bold">Availability</span><select value={draft.availability} onChange={(event) => setDraft({ ...draft, availability: event.target.value })} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-sm"><option value="ghana-stock">Ready in Ghana</option><option value="pre-order">Pre-order</option></select></label><Field label="Image URL" value={draft.image} onChange={(value) => setDraft({ ...draft, image: value })} testId="input-edit-product-image" /><Field label="Colours (comma separated)" value={draft.colors} onChange={(value) => setDraft({ ...draft, colors: value })} testId="input-edit-product-colors" /><Field label="Sizes (comma separated)" value={draft.sizes} onChange={(value) => setDraft({ ...draft, sizes: value })} testId="input-edit-product-sizes" /><label className="sm:col-span-2"><span className="text-sm font-bold">Description</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-input bg-card p-4 text-sm" /></label><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={draft.featured} onChange={(event) => setDraft({ ...draft, featured: event.target.checked })} /> Featured product</label><div className="flex justify-end sm:col-span-2"><button disabled={update.isPending} className="rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">{update.isPending ? 'Saving…' : 'Save product'}</button></div></div></form></div>}</AdminShell>;
}

function Inventory() {
  const inventory = useListAdminInventory({ query: { queryKey: getListAdminInventoryQueryKey() } });
  const update = useUpdateInventory();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const rows = (inventory.data ?? []).filter((p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.category.toLowerCase().includes(search.toLowerCase()));
  const refresh = () => { void client.invalidateQueries({ queryKey: getListAdminInventoryQueryKey() }); void client.invalidateQueries({ queryKey: getListProductsQueryKey() }); void client.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() }); };
  const save = (product: Product, data: { stockQuantity?: number; hidden?: boolean }) => update.mutate({ id: product.id, data }, { onSuccess: refresh });
  return <AdminShell><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow text-primary">Stock control</p><h1 className="serif mt-2 text-4xl font-semibold">Know what is on hand.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Every product, including hidden and sold-out pieces. Adjust quantities without losing the storefront record.</p></div><div className="rounded-full bg-accent px-4 py-2 text-sm font-bold">{rows.length} products</div></div><div className="mt-8 flex gap-3"><label className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} /><span className="sr-only">Search inventory</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products or categories" className="h-12 w-full rounded-xl border border-input bg-card pl-10 pr-4 text-sm" data-testid="input-inventory-search" /></label><button onClick={() => inventory.refetch()} className="rounded-xl border border-border px-4 text-sm font-bold" data-testid="button-refresh-inventory"><RefreshCw size={16} /></button></div>{inventory.isError ? <div className="mt-6"><QueryError retry={() => inventory.refetch()} /></div> : inventory.isLoading ? <div className="mt-6 grid gap-3">{[1,2,3,4].map((i) => <div className="skeleton h-24 rounded-2xl" key={i} />)}</div> : !rows.length ? <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-16 text-center"><Warehouse className="mx-auto text-primary" /><h2 className="serif mt-3 text-2xl">No products match.</h2><p className="mt-2 text-sm text-muted-foreground">Try a different search.</p></div> : <div className="mt-6 overflow-hidden rounded-2xl bg-card"><div className="hidden grid-cols-[1.4fr_110px_130px_150px] gap-4 border-b border-border bg-muted px-5 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground sm:grid"><span>Product</span><span>Stock</span><span>Visibility</span><span className="text-right">Action</span></div><div className="divide-y divide-border">{rows.map((product) => { const low = product.stockQuantity > 0 && product.stockQuantity <= 3; const sold = product.stockQuantity === 0; return <div key={product.id} className="grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_110px_130px_150px] sm:items-center" data-testid={`row-inventory-${product.id}`}><div className="flex items-center gap-3"><div className="h-14 w-12 overflow-hidden rounded-lg bg-muted">{product.images[0] && <img src={product.images[0]} alt="" className="h-full w-full object-cover" />}</div><div><p className="font-bold">{product.name}</p><p className="mt-1 text-xs text-muted-foreground">{product.category} · {money(product.price)}</p><div className="mt-2 flex flex-wrap gap-1">{sold && <span className="rounded-full bg-destructive/10 px-2 py-1 text-[10px] font-bold uppercase text-destructive">Sold out</span>}{low && <span className="rounded-full bg-accent px-2 py-1 text-[10px] font-bold uppercase">Low stock</span>}{product.hidden && <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-bold uppercase text-muted-foreground">Hidden</span>}</div></div></div><div><p className="text-xs text-muted-foreground sm:hidden">Stock</p>{editing === product.id ? <input autoFocus type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(product, { stockQuantity: Math.max(0, Number(quantity) || 0) }); }} className="h-10 w-24 rounded-lg border border-input bg-background px-3 text-sm font-bold" data-testid={`input-inventory-stock-${product.id}`} /> : <p className={`text-lg font-bold ${low || sold ? 'text-destructive' : ''}`}>{product.stockQuantity}</p>}</div><div><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${product.hidden ? 'bg-muted text-muted-foreground' : 'bg-accent'}`}>{product.hidden ? <EyeOff size={13} /> : <Eye size={13} />}{product.hidden ? 'Hidden' : 'Visible'}</span></div><div className="flex flex-wrap justify-start gap-2 sm:justify-end">{editing === product.id ? <><button onClick={() => save(product, { stockQuantity: Math.max(0, Number(quantity) || 0) })} className="rounded-full bg-primary px-3 py-2 text-xs font-bold text-primary-foreground" data-testid={`button-save-inventory-${product.id}`}>Save</button><button onClick={() => setEditing(null)} className="rounded-full border border-border px-3 py-2 text-xs font-bold">Cancel</button></> : <button onClick={() => { setEditing(product.id); setQuantity(String(product.stockQuantity)); }} className="rounded-full border border-border px-3 py-2 text-xs font-bold" data-testid={`button-adjust-inventory-${product.id}`}>Adjust stock</button>}<button onClick={() => save(product, { hidden: !product.hidden })} disabled={update.isPending} className="rounded-full border border-border px-3 py-2 text-xs font-bold" data-testid={`button-toggle-visibility-${product.id}`}>{product.hidden ? 'Restore' : 'Hide'}</button></div></div>; })}</div></div> }</AdminShell>;
}

function AdminProductsClean() {
  const products = useListAdminInventory({ query: { queryKey: getListAdminInventoryQueryKey() } });
  const update = useUpdateProduct();
  const client = useQueryClient();
  const [selected, setSelected] = useState<Product | null>(null);
  const [form, setForm] = useState({ name: '', category: '', description: '', price: '', costPrice: '', costCurrency: 'GHS' as 'GHS' | 'CNY', stockQuantity: '', availability: 'ghana-stock', featured: false });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getListAdminInventoryQueryKey() });
    void client.invalidateQueries({ queryKey: getListProductsQueryKey() });
  };
  const edit = (product: Product) => {
    setSelected(product);
    setForm({ name: product.name, category: product.category, description: product.description, price: String(product.price), costPrice: product.costPrice == null ? '' : String(product.costPrice), costCurrency: product.costCurrency ?? 'GHS', stockQuantity: String(product.stockQuantity), availability: product.availability, featured: product.featured });
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    update.mutate({ id: selected.id, data: { name: form.name, category: form.category, description: form.description, price: Number(form.price), costPrice: form.costPrice ? Number(form.costPrice) : null, costCurrency: form.costCurrency, stockQuantity: Number(form.stockQuantity), availability: form.availability as Product['availability'], featured: form.featured } }, { onSuccess: () => { refresh(); setSelected(null); } });
  };
  return <AdminShell><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow text-primary">Catalog</p><h1 className="serif mt-2 text-4xl font-semibold">Products and stock.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Selling prices and landed costs, kept together for every product.</p></div><span className="text-sm text-muted-foreground">{products.data?.length ?? 0} products</span></div><AdminProductForm /><div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{products.data?.map((product) => <article key={product.id} className="overflow-hidden rounded-2xl bg-card"><div className="aspect-[16/9] bg-muted">{product.images[0] && <img src={product.images[0]} alt="" className="h-full w-full object-cover" />}</div><div className="p-5"><p className="eyebrow text-muted-foreground">{product.category}</p><h2 className="mt-1 font-bold">{product.name}</h2><div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-background p-3 text-xs"><div><p className="text-muted-foreground">Selling price</p><p className="mt-1 font-bold">{money(product.price, 'GHS')}</p></div><div><p className="text-muted-foreground">Cost price</p><p className="mt-1 font-bold">{product.costPrice == null ? 'Not set' : money(product.costPrice, product.costCurrency ?? 'GHS')}</p></div></div><div className="mt-4 flex items-center justify-between text-xs text-muted-foreground"><span>{product.stockQuantity} in stock</span><button onClick={() => edit(product)} className="rounded-full bg-secondary px-4 py-2 font-bold text-secondary-foreground" data-testid={`button-edit-product-${product.id}`}>Edit product</button></div></div></article>)}</div>{selected && <div className="fixed inset-0 z-50 flex items-end justify-center bg-secondary/50 sm:items-center sm:p-6"><form onSubmit={save} className="max-h-[95dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-background p-6 shadow-2xl sm:rounded-3xl"><div className="flex items-center justify-between"><div><p className="eyebrow text-primary">Edit product</p><h2 className="serif mt-2 text-3xl">{selected.name}</h2></div><button type="button" onClick={() => setSelected(null)} className="rounded-full border border-border p-2"><X size={17} /></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><Field label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required testId="input-clean-product-name" /><Field label="Category" value={form.category} onChange={(value) => setForm({ ...form, category: value })} required testId="input-clean-product-category" /><Field label="Selling price (GHS)" type="number" value={form.price} onChange={(value) => setForm({ ...form, price: value })} required testId="input-clean-product-price" /><label><span className="text-sm font-bold">Cost price</span><input type="number" value={form.costPrice} onChange={(event) => setForm({ ...form, costPrice: event.target.value })} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-sm" data-testid="input-clean-product-cost" /></label><label><span className="text-sm font-bold">Cost currency</span><select value={form.costCurrency} onChange={(event) => setForm({ ...form, costCurrency: event.target.value as 'GHS' | 'CNY' })} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-sm" data-testid="select-clean-product-cost-currency"><option value="GHS">GHS</option><option value="CNY">CNY</option></select></label><Field label="Stock quantity" type="number" value={form.stockQuantity} onChange={(value) => setForm({ ...form, stockQuantity: value })} required testId="input-clean-product-stock" /><label><span className="text-sm font-bold">Availability</span><select value={form.availability} onChange={(event) => setForm({ ...form, availability: event.target.value })} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-sm"><option value="ghana-stock">Ready in Ghana</option><option value="pre-order">Pre-order</option></select></label><label className="sm:col-span-2"><span className="text-sm font-bold">Description</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-input bg-card p-4 text-sm" /></label><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.featured} onChange={(event) => setForm({ ...form, featured: event.target.checked })} /> Featured product</label></div><button disabled={update.isPending} className="mt-6 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">{update.isPending ? 'Saving…' : 'Save product'}</button></form></div>}</AdminShell>;
}

function InventoryClean() {
  const inventory = useListAdminInventory({ query: { queryKey: getListAdminInventoryQueryKey() } });
  const update = useUpdateInventory();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const rows = (inventory.data ?? []).filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(search.toLowerCase()));
  const refresh = () => { void client.invalidateQueries({ queryKey: getListAdminInventoryQueryKey() }); void client.invalidateQueries({ queryKey: getListProductsQueryKey() }); };
  const save = (product: Product, data: { stockQuantity?: number; hidden?: boolean }) => update.mutate({ id: product.id, data }, { onSuccess: refresh });
  return <AdminShell><p className="eyebrow text-primary">Stock control</p><h1 className="serif mt-2 text-4xl font-semibold">Inventory and pricing.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Selling price and cost price stay visible beside every stock record.</p><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products or categories" className="mt-8 h-12 w-full rounded-xl border border-input bg-card px-4 text-sm" data-testid="input-inventory-search" /><div className="mt-6 overflow-hidden rounded-2xl bg-card divide-y divide-border">{rows.map((product) => <div key={product.id} className="grid gap-4 p-5 sm:grid-cols-[1.5fr_1fr_1fr_auto] sm:items-center" data-testid={`row-inventory-${product.id}`}><div><p className="font-bold">{product.name}</p><p className="mt-1 text-xs text-muted-foreground">{product.category}</p></div><div><p className="text-xs text-muted-foreground">Selling price</p><p className="mt-1 font-bold">{money(product.price, 'GHS')}</p></div><div><p className="text-xs text-muted-foreground">Cost price</p><p className="mt-1 font-bold">{product.costPrice == null ? 'Not set' : money(product.costPrice, product.costCurrency ?? 'GHS')}</p></div><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold">{product.stockQuantity} stock</span>{editing === product.id ? <><input autoFocus type="number" min="0" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="h-9 w-20 rounded-lg border border-input px-2 text-sm" /><button onClick={() => { save(product, { stockQuantity: Math.max(0, Number(quantity) || 0) }); setEditing(null); }} className="rounded-full bg-primary px-3 py-2 text-xs font-bold text-primary-foreground">Save</button></> : <button onClick={() => { setEditing(product.id); setQuantity(String(product.stockQuantity)); }} className="rounded-full border border-border px-3 py-2 text-xs font-bold">Adjust stock</button>}<button onClick={() => save(product, { hidden: !product.hidden })} className="rounded-full border border-border px-3 py-2 text-xs font-bold">{product.hidden ? 'Restore' : 'Hide'}</button></div></div>)}</div></AdminShell>;
}

function Customers() {
  const [search, setSearch] = useState('');
  const params = useMemo(() => ({ search: search || undefined }), [search]);
  const customers = useListCustomers(params, { query: { queryKey: getListCustomersQueryKey(params) } });
  const [selected, setSelected] = useState<Customer | null>(null);
  const list = customers.data ?? [];
  return <AdminShell><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow text-primary">People behind the orders</p><h1 className="serif mt-2 text-4xl font-semibold">Customers, remembered.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">A searchable view of returning customers, balances, and what is moving now.</p></div><div className="rounded-full bg-accent px-4 py-2 text-sm font-bold">{list.length} customers</div></div><label className="relative mt-8 block"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={17} /><span className="sr-only">Search customers</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone, or WhatsApp" className="h-12 w-full rounded-xl border border-input bg-card pl-11 pr-4 text-sm" data-testid="input-customer-search" /></label>{customers.isError ? <div className="mt-6"><QueryError retry={() => customers.refetch()} /></div> : customers.isLoading ? <div className="mt-6 space-y-3">{[1,2,3].map((i) => <div className="skeleton h-24 rounded-2xl" key={i} />)}</div> : !list.length ? <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-16 text-center"><Users className="mx-auto text-primary" /><h2 className="serif mt-3 text-2xl">No customers found.</h2></div> : <div className="mt-6 overflow-hidden rounded-2xl bg-card"><div className="hidden grid-cols-[1.4fr_1fr_110px_130px] gap-4 border-b border-border bg-muted px-5 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground sm:grid"><span>Customer</span><span>Contact</span><span>Orders</span><span className="text-right">Purchases</span></div><div className="divide-y divide-border">{list.map((customer) => <button type="button" onClick={() => setSelected(customer)} key={customer.key} className="grid w-full gap-4 px-5 py-5 text-left transition-colors hover:bg-muted/40 sm:grid-cols-[1.4fr_1fr_110px_130px] sm:items-center" data-testid={`row-customer-${customer.key}`}><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent font-bold text-accent-foreground">{customer.name.split(' ').map((n) => n[0]).slice(0,2).join('')}</span><div><p className="font-bold">{customer.name}</p><p className="mt-1 text-xs text-muted-foreground">{customer.city} · Last order {shortDate(customer.lastOrderAt)}</p></div></div><div className="text-sm"><p>{customer.whatsapp || customer.phone}</p><p className="mt-1 text-xs text-muted-foreground">{customer.address}</p></div><p><span className="text-xs text-muted-foreground sm:hidden">Orders · </span><strong>{customer.orderCount}</strong>{customer.currentOrders > 0 && <span className="ml-2 rounded-full bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground">{customer.currentOrders} current</span>}</p><div className="text-left sm:text-right"><p className="font-bold">{money(customer.totalPurchases)}</p>{customer.outstandingBalance > 0 && <p className="mt-1 text-xs font-semibold text-destructive">{money(customer.outstandingBalance)} due</p>}</div></button>)}</div></div>}{selected && <CustomerDetail customer={selected} onClose={() => setSelected(null)} />}</AdminShell>;
}

function CustomerDetail({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-secondary/60 sm:items-center sm:p-6" role="dialog" aria-modal="true"><div className="max-h-[92dvh] w-full max-w-3xl overflow-auto rounded-t-3xl bg-background p-5 shadow-2xl sm:rounded-3xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow text-primary">Customer profile</p><h2 className="serif mt-2 text-3xl font-semibold">{customer.name}</h2><p className="mt-2 text-sm text-muted-foreground">{customer.city} · {customer.address}</p></div><button onClick={onClose} className="rounded-full border border-border p-2" aria-label="Close customer profile" data-testid="button-close-customer"><X size={17} /></button></div><div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-xl bg-card p-4"><p className="text-xs text-muted-foreground">Orders</p><p className="mt-2 text-xl font-bold">{customer.orderCount}</p></div><div className="rounded-xl bg-card p-4"><p className="text-xs text-muted-foreground">Purchases</p><p className="mt-2 text-xl font-bold">{money(customer.totalPurchases)}</p></div><div className="rounded-xl bg-card p-4"><p className="text-xs text-muted-foreground">Outstanding</p><p className="mt-2 text-xl font-bold text-destructive">{money(customer.outstandingBalance)}</p></div><div className="rounded-xl bg-card p-4"><p className="text-xs text-muted-foreground">Current orders</p><p className="mt-2 text-xl font-bold">{customer.currentOrders}</p></div></div><div className="mt-6 rounded-2xl bg-card p-5"><p className="eyebrow text-muted-foreground">Contact</p><div className="mt-3 flex flex-wrap gap-3 text-sm"><a href={`tel:${customer.phone}`} className="rounded-full border border-border px-4 py-2 font-bold" data-testid="link-customer-phone"><Phone size={14} className="mr-2 inline" />{customer.phone}</a>{(customer.whatsapp || customer.phone) && <a href={`https://wa.me/${(customer.whatsapp || customer.phone).replace(/\\D/g, '')}`} target="_blank" rel="noreferrer" className="rounded-full bg-accent px-4 py-2 font-bold" data-testid="link-customer-whatsapp"><MessageCircle size={14} className="mr-2 inline" />Open WhatsApp</a>}</div></div><div className="mt-6"><p className="eyebrow text-muted-foreground">Order history</p><div className="mt-3 divide-y divide-border rounded-2xl bg-card px-5">{customer.orders.map((order) => <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-bold">{order.orderNumber}</p><p className="mt-1 text-xs text-muted-foreground">{date(order.createdAt)} · {order.status}</p></div><div className="text-right"><p className="font-bold">{money(order.totalAmount)}</p><p className="text-xs text-muted-foreground">{order.paymentStatus}{order.balance > 0 ? ` · ${money(order.balance)} due` : ''}</p></div></div>)}</div></div></div></div>;
}

function AdminShipments() {
  const shipments = useListShipments({ query: { queryKey: getListShipmentsQueryKey() } });
  const create = useCreateShipment();
  const update = useUpdateShipment();
  const remove = useDeleteShipment();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Shipment | null>(null);
  const [form, setForm] = useState({ name: '', status: 'preparing', preOrderCloseDate: '', expectedArrival: '', actualArrival: '', orderCount: '0', notes: '' });
  const statusStyle = (status: Shipment['status']) => status === 'arrived' || status === 'completed' ? 'bg-accent text-accent-foreground' : status === 'in-transit' ? 'bg-primary text-primary-foreground' : 'bg-muted';
  const refresh = () => { void client.invalidateQueries({ queryKey: getListShipmentsQueryKey() }); void client.invalidateQueries({ queryKey: getListProductBatchesQueryKey() }); void client.invalidateQueries({ queryKey: getListProductsQueryKey() }); void client.invalidateQueries({ queryKey: getListAdminInventoryQueryKey() }); void client.invalidateQueries({ queryKey: getGetAdminEtaRemindersQueryKey() }); void refreshOrderViews(client); };
  const beginCreate = () => { setEditing(null); setForm({ name: '', status: 'preparing', preOrderCloseDate: '', expectedArrival: '', actualArrival: '', orderCount: '0', notes: '' }); setOpen(true); };
  const beginEdit = (shipment: Shipment) => { setEditing(shipment); setForm({ name: shipment.name, status: shipment.status, preOrderCloseDate: shipment.preOrderCloseDate ?? '', expectedArrival: shipment.expectedArrival, actualArrival: shipment.actualArrival ?? '', orderCount: String(shipment.orderCount), notes: shipment.notes ?? '' }); setOpen(true); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const data = { name: form.name, status: form.status as Shipment['status'], expectedArrival: form.expectedArrival, preOrderCloseDate: form.preOrderCloseDate || null, actualArrival: form.actualArrival || null, orderCount: Number(form.orderCount) || 0, notes: form.notes || null };
    const done = () => { refresh(); setOpen(false); };
    if (editing) update.mutate({ id: editing.id, data }, { onSuccess: done });
    else create.mutate({ data }, { onSuccess: done });
  };
  const deleteShipment = (shipment: Shipment) => { if (window.confirm(`Delete shipment ${shipment.name}?`)) remove.mutate({ id: shipment.id }, { onSuccess: refresh }); };
  return <AdminShell><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow text-primary">Import flow</p><h1 className="serif mt-2 text-4xl font-semibold">Nothing arrives by accident.</h1><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">Create batches, update progress, arrival dates, notes and linked order counts.</p></div><button onClick={beginCreate} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground" data-testid="button-new-shipment"><Plus size={16} /> New batch</button></div><div className="mt-8 grid gap-4 md:grid-cols-2">{shipments.isError ? <div className="md:col-span-2"><QueryError retry={() => shipments.refetch()} /></div> : shipments.isLoading ? [1,2,3,4].map((item) => <div className="skeleton h-52 rounded-2xl" key={item} />) : shipments.data?.length ? shipments.data.map((shipment) => <div key={shipment.id} className="rounded-2xl bg-card p-6" data-testid={`card-shipment-${shipment.id}`}><div className="flex items-start justify-between gap-3"><div><p className="eyebrow text-muted-foreground">Batch {String(shipment.id).padStart(2,'0')}</p><h2 className="serif mt-2 text-2xl">{shipment.name}</h2></div><span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[.1em] ${statusStyle(shipment.status)}`}>{shipment.status.replace('-', ' ')}</span></div><div className="mt-8 grid grid-cols-2 gap-4 border-t border-border pt-5"><div><p className="text-xs text-muted-foreground">Preorder closes</p><p className="mt-1 text-sm font-bold">{shipment.preOrderCloseDate ? date(shipment.preOrderCloseDate) : 'Not set'}</p></div><div><p className="text-xs text-muted-foreground">Expected arrival</p><p className="mt-1 text-sm font-bold">{date(shipment.expectedArrival)}</p></div><div><p className="text-xs text-muted-foreground">Linked orders</p><p className="mt-1 text-sm font-bold">{shipment.orderCount}</p></div></div>{shipment.notes && <p className="mt-5 text-sm leading-6 text-muted-foreground">{shipment.notes}</p>}<div className="mt-5 flex gap-2"><button onClick={() => beginEdit(shipment)} className="flex-1 rounded-full bg-secondary px-4 py-2.5 text-xs font-bold text-secondary-foreground">Edit batch</button><button onClick={() => deleteShipment(shipment)} className="rounded-full border border-destructive/30 p-2.5 text-destructive"><Trash2 size={15} /></button></div></div>) : <div className="md:col-span-2 rounded-2xl border border-dashed border-border p-16 text-center"><Truck className="mx-auto text-primary" /><p className="serif mt-3 text-xl">No shipment batches yet.</p><p className="mt-1 text-sm text-muted-foreground">Create the first batch to start tracking imports.</p></div>}</div>{open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-secondary/50 sm:items-center sm:p-6"><form onSubmit={submit} className="w-full max-w-xl rounded-t-3xl bg-background p-6 shadow-2xl sm:rounded-3xl"><div className="flex items-center justify-between"><div><p className="eyebrow text-primary">{editing ? 'Edit batch' : 'New batch'}</p><h2 className="serif mt-2 text-3xl">{editing?.name ?? 'Create shipment'}</h2></div><button type="button" onClick={() => setOpen(false)} className="rounded-full border border-border p-2"><X size={17} /></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><Field label="Batch name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required testId="input-shipment-name" /><label><span className="text-sm font-bold">Status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-sm"><option value="preparing">Preparing</option><option value="in-transit">In transit</option><option value="arrived">Arrived</option><option value="completed">Completed</option></select></label><Field label="Preorder closing date" type="date" value={form.preOrderCloseDate} onChange={(value) => setForm({ ...form, preOrderCloseDate: value })} required testId="input-shipment-closing" /><Field label="Expected arrival" type="date" value={form.expectedArrival} onChange={(value) => setForm({ ...form, expectedArrival: value })} required testId="input-shipment-expected" /><Field label="Actual arrival" type="date" value={form.actualArrival} onChange={(value) => setForm({ ...form, actualArrival: value })} testId="input-shipment-actual" /><Field label="Linked order count" type="number" value={form.orderCount} onChange={(value) => setForm({ ...form, orderCount: value })} testId="input-shipment-orders" /><label className="sm:col-span-2"><span className="text-sm font-bold">Notes</span><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-input bg-card p-4 text-sm" /></label><div className="flex justify-end sm:col-span-2"><button disabled={create.isPending || update.isPending} className="rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">{create.isPending || update.isPending ? 'Saving…' : 'Save batch'}</button></div></div></form></div>}</AdminShell>;
}

function DashboardMoneyCard({ label, amount, cny, detail }: { label: string; amount: number; cny: string; detail?: string }) {
  return <div className="rounded-2xl bg-card p-5"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold">{money(amount)}</p><p className="mt-1 text-sm text-muted-foreground">{cny}</p>{detail && <p className="mt-2 text-xs font-bold text-primary">{detail}</p>}</div>;
}

function DashboardFinanceContent({ summary }: { summary: DashboardSummary }) {
  const rateQuery = useGetExchangeRate({ query: { queryKey: getGetExchangeRateQueryKey() } });
  const updateRate = useUpdateExchangeRate();
  const [rate, setRate] = useState('');
  useEffect(() => { if (rateQuery.data) setRate(String(rateQuery.data.cnyRateGhs)); }, [rateQuery.data]);
  const cny = (ghs: number) => rateQuery.data?.cnyRateGhs ? money(ghs / rateQuery.data.cnyRateGhs, 'CNY') : '—';
  return <section className="space-y-5" data-testid="dashboard-finance"><div className="rounded-2xl bg-card p-5"><form onSubmit={(event) => { event.preventDefault(); updateRate.mutate({ data: { cnyRateGhs: Number(rate) } }, { onSuccess: () => window.location.reload() }); }} className="flex flex-col gap-3 sm:flex-row sm:items-end"><Field label="Current CNY rate (GHS per ¥1)" type="number" value={rate} onChange={setRate} required testId="input-cny-rate" /><button className="h-12 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground" disabled={updateRate.isPending}>Save rate</button></form><p className="mt-2 text-xs text-muted-foreground">Every yuan figure below uses this rate. CNY equivalents appear directly below GHS.</p></div><div className="grid gap-4 sm:grid-cols-3"><DashboardMoneyCard label="Total cost" amount={summary.totalCost} cny={cny(summary.totalCost)} /><DashboardMoneyCard label="Gross profit" amount={summary.grossProfit} cny={cny(summary.grossProfit)} detail={`${summary.grossMarginPercentage.toFixed(1)}% margin`} /><DashboardMoneyCard label="Current month sales" amount={summary.currentMonthSales} cny={cny(summary.currentMonthSales)} detail={`Previous month ${money(summary.previousMonthSales)} · ${cny(summary.previousMonthSales)}`} /></div><div className="rounded-2xl bg-card p-5 sm:p-7"><p className="eyebrow text-muted-foreground">Profit trend</p><h2 className="serif mt-2 text-2xl font-semibold">Revenue, cost and profit by month.</h2><div className="mt-6 space-y-3">{summary.salesByMonth.map((period) => <div key={period.month} className="rounded-xl bg-background p-4"><div className="flex justify-between text-sm font-bold"><span>{period.label}</span><span>{period.marginPercentage.toFixed(1)}% margin</span></div><div className="mt-3 grid grid-cols-3 gap-3 text-xs"><span>Revenue<strong className="mt-1 block text-sm">{money(period.sales)}<small className="block font-normal text-muted-foreground">{cny(period.sales)}</small></strong></span><span>Cost<strong className="mt-1 block text-sm">{money(period.cost)}<small className="block font-normal text-muted-foreground">{cny(period.cost)}</small></strong></span><span>Profit<strong className="mt-1 block text-sm text-primary">{money(period.profit)}<small className="block font-normal text-muted-foreground">{cny(period.profit)}</small></strong></span></div></div>)}</div></div></section>;
}

function DashboardFinanceContentClean({ summary }: { summary: DashboardSummary }) {
  const rateQuery = useGetExchangeRate({ query: { queryKey: getGetExchangeRateQueryKey() } });
  const updateRate = useUpdateExchangeRate();
  const [rate, setRate] = useState('');
  useEffect(() => { if (rateQuery.data) setRate(String(rateQuery.data.cnyPerGhs)); }, [rateQuery.data]);
  const cny = (ghs: number) => rateQuery.data?.cnyPerGhs ? money(ghs * rateQuery.data.cnyPerGhs, 'CNY') : '—';
  return <section className="space-y-5" data-testid="dashboard-finance"><div className="rounded-2xl bg-card p-5"><form onSubmit={(event) => { event.preventDefault(); updateRate.mutate({ data: { cnyPerGhs: Number(rate) } }, { onSuccess: () => window.location.reload() }); }} className="flex flex-col gap-3 sm:flex-row sm:items-end"><Field label="Yuan per GHS 1" type="number" value={rate} onChange={setRate} required testId="input-cny-rate" /><button className="h-12 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground" disabled={updateRate.isPending}>Save rate</button></form><p className="mt-2 text-xs text-muted-foreground">CNY equivalents use the current yuan value for GHS 1.</p></div><div className="grid gap-4 sm:grid-cols-3"><DashboardMoneyCard label="Total cost" amount={summary.totalCost} cny={cny(summary.totalCost)} /><DashboardMoneyCard label="Gross profit" amount={summary.grossProfit} cny={cny(summary.grossProfit)} detail={`${summary.grossMarginPercentage.toFixed(1)}% margin`} /><DashboardMoneyCard label="Current month sales" amount={summary.currentMonthSales} cny={cny(summary.currentMonthSales)} detail={`Previous month ${money(summary.previousMonthSales)} · ${cny(summary.previousMonthSales)}`} /></div></section>;
}

function DashboardFinancePanel({ summary }: { summary: DashboardSummary }) {
  const finance = summary as DashboardSummary & { costDataComplete?: boolean; missingCostOrderCount?: number };
  return <section className="space-y-4">{finance.costDataComplete === false && <div className="rounded-xl border border-accent/40 bg-accent/20 p-4 text-sm" role="alert"><strong>Profit data is incomplete.</strong> Profit excludes {finance.missingCostOrderCount ?? 'some'} order(s) or item(s) without historical cost prices.</div>}<DashboardFinanceContentClean summary={summary} /></section>;
}

function OperationsDashboard() {
  const dashboard = useGetAdminDashboard({ query: { queryKey: getGetAdminDashboardQueryKey() } });
  const summary = dashboard.data;
  const trend = summary?.salesTrendDirection;
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const maxSales = Math.max(...(summary?.salesByMonth ?? []).map((item) => item.sales), 1);
  return <AdminShell>{summary && <DashboardFinancePanel summary={summary} />}
    {dashboard.isLoading ? <div className="space-y-5"><div className="skeleton h-32 rounded-3xl" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1,2,3,4].map((item) => <div className="skeleton h-28 rounded-2xl" key={item} />)}</div><div className="skeleton h-80 rounded-2xl" /></div> : dashboard.isError || !summary ? <QueryError retry={() => dashboard.refetch()} /> : <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow text-primary">Operations desk</p><h1 className="serif mt-2 text-4xl font-semibold tracking-tight">Know what is moving.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">A clear read on sales, collections and the goods currently making their way to customers.</p></div><p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat('en-GH', { dateStyle: 'full' }).format(new Date())}</p></div>
      <div className={`rounded-3xl p-5 text-secondary-foreground sm:p-7 ${trend === 'up' ? 'bg-secondary' : trend === 'down' ? 'bg-primary' : 'bg-secondary'}`} data-testid="status-sales-trend"><div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="eyebrow text-accent">Sales direction</p><div className="mt-3 flex items-center gap-3"><TrendIcon size={30} /><p className="serif text-3xl font-semibold">{trend === 'up' ? 'Sales are going up' : trend === 'down' ? 'Sales are trending down' : 'Sales are holding flat'}</p></div><p className="mt-2 text-sm text-secondary-foreground/70">Compared with last month: {summary.previousMonthSales ? `${Math.abs(summary.salesTrendPercentage).toFixed(1)}% ${trend === 'up' ? 'higher' : trend === 'down' ? 'lower' : 'change'}` : 'not enough history yet'}.</p></div><div className="text-left sm:text-right"><p className="text-xs text-secondary-foreground/60">This month</p><p className="mt-1 text-3xl font-bold">{money(summary.currentMonthSales)}</p><p className="mt-1 text-xs text-secondary-foreground/60">Last month {money(summary.previousMonthSales)}</p></div></div></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Total sales" value={money(summary.totalSales)} detail="All recorded revenue" accent /><StatCard label="Orders received" value={String(summary.ordersReceived)} detail={`${summary.paidOrders} paid in full`} /><StatCard label="To collect" value={money(summary.outstandingBalance)} detail={`${summary.unpaidOrPartialOrders} partially paid pre-orders`} /><StatCard label="Ghana stock sales" value={money(summary.ghanaStockSales)} detail={`${summary.availableStock} pieces available`} /></div>
      <div className="grid gap-5 xl:grid-cols-[1.4fr_.6fr]"><section className="rounded-2xl bg-card p-5 sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow text-muted-foreground">Sales rhythm</p><h2 className="serif mt-2 text-2xl font-semibold">Revenue by month</h2></div><BarChart3 className="text-primary" /></div><div className="mt-8 flex h-56 items-end gap-2 border-b border-border pb-0 sm:gap-4">{summary.salesByMonth.map((item) => <div key={item.month} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] font-bold opacity-0 transition-opacity group-hover:opacity-100">{money(item.sales)}</span><div className="w-full max-w-12 rounded-t-lg bg-primary transition-all group-hover:bg-accent" style={{ height: `${Math.max(8, (item.sales / maxSales) * 170)}px` }} title={`${item.label}: ${money(item.sales)}`} /><span className="truncate text-[10px] text-muted-foreground">{item.label}</span></div>)}</div></section><section className="rounded-2xl bg-card p-5 sm:p-7"><p className="eyebrow text-muted-foreground">Best sellers</p><h2 className="serif mt-2 text-2xl font-semibold">What is earning attention</h2><div className="mt-6 space-y-4">{summary.bestSellingProducts.slice(0, 5).map((item, index) => <div key={item.productId} className="flex items-center gap-3" data-testid={`row-best-product-${item.productId}`}><span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-bold">{String(index + 1).padStart(2, '0')}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.productName}</p><p className="text-xs text-muted-foreground">{item.quantity} sold</p></div><p className="text-sm font-bold">{money(item.revenue)}</p></div>)}{!summary.bestSellingProducts.length && <p className="py-8 text-sm text-muted-foreground">Sales will appear here as orders come in.</p>}</div></section></div>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><section className="rounded-2xl bg-card p-5 sm:p-7"><div className="flex items-center justify-between"><div><p className="eyebrow text-muted-foreground">Latest orders</p><h2 className="serif mt-2 text-2xl font-semibold">Keep things moving.</h2></div><Link href="/admin/orders" className="text-sm font-bold text-primary" data-testid="admin-link-all-orders">View all</Link></div><div className="mt-5 divide-y divide-border">{summary.recentOrders.slice(0, 6).map((order) => <OrderRow key={order.id} order={order} compact />)}{!summary.recentOrders.length && <p className="py-10 text-center text-sm text-muted-foreground">No orders yet.</p>}</div></section><section className="rounded-2xl bg-secondary p-5 text-secondary-foreground sm:p-7"><p className="eyebrow text-accent">Import flow</p><p className="serif mt-3 text-3xl">Incoming goods, accounted for.</p><div className="mt-7 grid grid-cols-2 gap-4 border-t border-secondary-foreground/15 pt-5"><div><p className="text-xs text-secondary-foreground/60">Pre-order sales</p><p className="mt-1 text-xl font-bold">{money(summary.preOrderSales)}</p></div><div><p className="text-xs text-secondary-foreground/60">Orders to place</p><p className="mt-1 text-xl font-bold">{summary.unpaidOrPartialOrders}</p></div></div><Link href="/admin/shipments" className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-accent" data-testid="admin-link-shipments-card">Open shipment batches <ArrowRight size={15} /></Link></section></div>
    </div>}
  </AdminShell>;
}

function statusStyle(status: string) {
  return status === 'arrived' || status === 'completed' ? 'bg-accent text-accent-foreground' : status === 'in-transit' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground';
}

function ProcurementTable({ orders, testId }: { orders: Order[]; testId: string }) {
  const rows = procurementBreakdown(orders);
  const excluded = orders.filter((order) => !countsForProcurement(order)).length;
  return <section className="rounded-lg border border-border bg-card p-3" data-testid={testId} aria-label="Procurement breakdown">
    <p className="text-xs font-bold">Procurement breakdown</p>
    <p className="mt-1 text-[11px] text-muted-foreground">Paid and partially paid orders only; cancelled and unpaid orders are not counted.{excluded > 0 ? ` ${excluded} order(s) excluded.` : ''}</p>
    {rows.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Nothing to procure yet.</p> : <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[22rem] text-left text-xs"><thead className="text-muted-foreground"><tr><th className="py-1 pr-2 font-semibold">Product</th><th className="pr-2 font-semibold">Size</th><th className="pr-2 font-semibold">Colour</th><th className="pr-2 font-semibold">Type</th><th className="text-right font-semibold">Qty</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key} className="border-t border-border"><td className="py-1.5 pr-2 font-semibold">{row.productName}</td><td className="pr-2">{row.size ?? '—'}</td><td className="pr-2">{row.color ?? '—'}</td><td className="pr-2">{row.variantType && row.variantType !== row.size ? row.variantType : '—'}</td><td className="text-right font-bold">{row.quantity}</td></tr>)}</tbody></table></div>}
  </section>;
}

function OperationsShipments() {
  const client = useQueryClient();
  const shipments = useListShipments({ query: { ...orderFreshness, queryKey: getListShipmentsQueryKey() } });
  const ordersQuery = useListAdminOrders(undefined, { query: { ...orderFreshness, queryKey: getListAdminOrdersQueryKey() } });
  const create = useCreateShipment(); const update = useUpdateShipment(); const remove = useDeleteShipment();
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<Shipment | null>(null); const [expanded, setExpanded] = useState<number | null>(null);
  const blank = { name: '', status: 'preparing', preOrderCloseDate: '', expectedArrival: '', actualArrival: '', notes: '', orderIds: [] as number[], productFees: [] as { productId: number; productName: string; feePerItem: number }[] };
  const [form, setForm] = useState(blank);
  const refresh = () => { void client.invalidateQueries({ queryKey: getListShipmentsQueryKey() }); void client.invalidateQueries({ queryKey: getListProductBatchesQueryKey() }); void client.invalidateQueries({ queryKey: getListProductsQueryKey() }); void client.invalidateQueries({ queryKey: getListAdminInventoryQueryKey() }); void client.invalidateQueries({ queryKey: getGetAdminEtaRemindersQueryKey() }); void refreshOrderViews(client); };
  const start = (shipment?: Shipment) => { setEditing(shipment ?? null); setForm(shipment ? { name: shipment.name, status: shipment.status, preOrderCloseDate: shipment.preOrderCloseDate ?? '', expectedArrival: shipment.expectedArrival.slice(0, 10), actualArrival: shipment.actualArrival?.slice(0, 10) ?? '', notes: shipment.notes ?? '', orderIds: shipment.orders.map((order) => order.id), productFees: shipment.productFees ?? [] } : blank); setOpen(true); };
  const feeProducts = useMemo(() => {
    const products = new Map<number, string>();
    (ordersQuery.data ?? [])
      .filter((order) => form.orderIds.includes(order.id))
      .flatMap((order) => order.items)
      .filter((item) => item.availability === 'pre-order')
      .forEach((item) => products.set(item.productId, item.productName));
    return Array.from(products, ([productId, productName]) => ({ productId, productName }));
  }, [ordersQuery.data, form.orderIds]);
  const hasArrived = form.status === 'arrived' || form.status === 'completed';
  const eligibleOrders = (ordersQuery.data ?? []).filter((order) => order.items.some((item) => item.availability === 'pre-order'));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const productFees = hasArrived ? [...form.productFees, ...feeProducts.filter((product) => !form.productFees.some((fee) => fee.productId === product.productId)).map((product) => ({ ...product, feePerItem: 0 }))] : form.productFees;
    const data = { name: form.name, status: form.status as Shipment['status'], expectedArrival: form.expectedArrival, preOrderCloseDate: form.preOrderCloseDate || null, actualArrival: form.actualArrival || null, notes: form.notes || null, orderIds: form.orderIds, productFees };
    const done = () => { refresh(); setOpen(false); };
    if (hasArrived && !form.actualArrival) return;
    if (editing) {
      const changes = shipmentEditorPatch(editing, data);
      if (!Object.keys(changes).length) { setOpen(false); return; }
      update.mutate({ id: editing.id, data: changes }, { onSuccess: done });
    }
    else create.mutate({ data }, { onSuccess: done });
  };
  const toggleOrder = (id: number) => setForm((current) => ({ ...current, orderIds: current.orderIds.includes(id) ? current.orderIds.filter((value) => value !== id) : [...current.orderIds, id] }));
  return <AdminShell><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow text-primary">Import flow</p><h1 className="serif mt-2 text-4xl font-semibold">Every incoming order, visible.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Build import batches from real orders, then inspect the customers and products riding together.</p></div><button onClick={() => start()} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground" data-testid="button-new-shipment"><Plus size={16} /> New batch</button></div>
     {shipments.isError || ordersQuery.isError ? <div className="mt-8"><QueryError retry={() => { void shipments.refetch(); void ordersQuery.refetch(); }} /></div> : shipments.isLoading || ordersQuery.isLoading ? <div className="mt-8 grid gap-4 md:grid-cols-2">{[1,2,3,4].map((item) => <div className="skeleton h-72 rounded-2xl" key={item} />)}</div> : <div className="mt-8 grid gap-4 md:grid-cols-2">{shipments.data?.map((shipment) => <article key={shipment.id} className="rounded-2xl bg-card p-5 transition-transform hover:-translate-y-0.5 sm:p-6" data-testid={`card-shipment-${shipment.id}`}><div className="flex items-start justify-between gap-3"><div><p className="eyebrow text-muted-foreground">Batch {String(shipment.id).padStart(2, '0')}</p><h2 className="serif mt-2 text-2xl">{shipment.name}</h2></div><span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[.1em] ${statusStyle(shipment.status)}`}>{shipment.status.replace('-', ' ')}</span></div><div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Preorder closes</p><p className="mt-1 text-sm font-bold">{shipment.preOrderCloseDate ? date(shipment.preOrderCloseDate) : 'Not set'}</p></div><div><p className="text-xs text-muted-foreground">Expected arrival</p><p className="mt-1 text-sm font-bold">{date(shipment.expectedArrival)}</p></div><div><p className="text-xs text-muted-foreground">Actual arrival</p><p className="mt-1 text-sm font-bold">{shipment.actualArrival ? date(shipment.actualArrival) : 'Not arrived yet'}</p></div><div><p className="text-xs text-muted-foreground">Linked orders</p><p className="mt-1 text-sm font-bold">{shipment.orderCount}</p></div></div><button onClick={() => setExpanded(expanded === shipment.id ? null : shipment.id)} className="mt-5 flex w-full items-center justify-between rounded-xl bg-background px-4 py-3 text-left text-sm font-bold" data-testid={`button-toggle-shipment-details-${shipment.id}`}><span>{expanded === shipment.id ? 'Hide order details' : 'Inspect customers and products'}</span><span>{expanded === shipment.id ? '−' : '+'}</span></button>{expanded === shipment.id && <div className="mt-3 space-y-3 rounded-xl border border-border p-3">{shipment.orders.length > 0 && <ProcurementTable orders={shipment.orders} testId={`table-procurement-${shipment.id}`} />}{shipment.orders.length ? shipment.orders.map((order) => <div key={order.id} className="rounded-lg bg-background p-3"><div className="flex justify-between gap-3"><p className="text-sm font-bold">{order.customerName}</p><p className="text-xs font-bold">{order.orderNumber}</p></div><p className="mt-1 text-xs text-muted-foreground">{order.items.map((item) => `${item.productName} (${lineSelection(item)}) × ${item.quantity}`).join('; ')}</p><p className="mt-2 text-xs text-muted-foreground">{money(order.totalAmount)} · {order.paymentStatus}{countsForProcurement(order) ? '' : ' · excluded from procurement'}</p></div>) : <p className="text-sm text-muted-foreground">No orders linked yet.</p>}{shipment.productNames.length > 0 && <p className="border-t border-border pt-3 text-xs text-muted-foreground"><span className="font-bold text-foreground">Products:</span> {shipment.productNames.join(', ')}</p>}</div>}{shipment.notes && <p className="mt-4 text-sm leading-6 text-muted-foreground">{shipment.notes}</p>}<div className="mt-5 flex gap-2"><button onClick={() => start(shipment)} className="flex-1 rounded-full bg-secondary px-4 py-2.5 text-xs font-bold text-secondary-foreground" data-testid={`button-edit-shipment-${shipment.id}`}>Edit batch</button><button onClick={() => { if (window.confirm(`Delete ${shipment.name}?`)) remove.mutate({ id: shipment.id }, { onSuccess: refresh }); }} className="rounded-full border border-destructive/30 p-2.5 text-destructive" data-testid={`button-delete-shipment-${shipment.id}`}><Trash2 size={15} /></button></div></article>)}{!shipments.data?.length && <div className="md:col-span-2 rounded-2xl border border-dashed border-border p-16 text-center"><Truck className="mx-auto text-primary" /><p className="serif mt-3 text-xl">No shipment batches yet.</p><p className="mt-1 text-sm text-muted-foreground">Create the first batch to start tracking imports.</p></div>}</div>}
      {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-secondary/60 sm:items-center sm:p-6">
        <form onSubmit={submit} className="max-h-[94dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-background p-6 shadow-2xl sm:rounded-3xl">
          <div className="flex items-center justify-between">
            <div><p className="eyebrow text-primary">{editing ? 'Edit batch' : 'New batch'}</p><h2 className="serif mt-2 text-3xl">{editing?.name ?? 'Create shipment'}</h2></div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-border p-2" data-testid="button-close-shipment-form"><X size={17} /></button>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field label="Batch name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required testId="input-shipment-name" />
            <label><span className="text-sm font-bold">Status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-sm" data-testid="select-shipment-status"><option value="preparing">Preparing</option><option value="in-transit">In transit</option><option value="arrived">Arrived</option><option value="completed">Completed</option></select></label>
            <Field label="Preorder closing date" type="date" value={form.preOrderCloseDate} onChange={(value) => setForm({ ...form, preOrderCloseDate: value })} required testId="input-shipment-closing" /><Field label="Expected arrival" type="date" value={form.expectedArrival} onChange={(value) => setForm({ ...form, expectedArrival: value })} required testId="input-shipment-expected" />
            <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">Expected dates send ETA updates only; they never confirm physical arrival. Date-only edits keep shipping payments and linked orders unchanged. Products follow batch closing and arrival dates unless a custom product date is set.</p>
            <Field label="Actual arrival" type="date" value={form.actualArrival} onChange={(value) => setForm({ ...form, actualArrival: value })} required={hasArrived} testId="input-shipment-actual" />
            <label className="sm:col-span-2">
              <span className="text-sm font-bold">Attach customer preorder orders</span>
              <span className="mt-1 block text-xs text-muted-foreground">Select the orders travelling in this batch.</span>
              <div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-xl border border-input bg-card p-3">
                {eligibleOrders.map((order) => <label key={order.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-3 transition-colors hover:bg-muted">
                  <input type="checkbox" checked={form.orderIds.includes(order.id)} onChange={() => toggleOrder(order.id)} data-testid={`checkbox-shipment-order-${order.id}`} />
                  <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{order.orderNumber} · {order.customerName}</span><span className="block text-xs text-muted-foreground">{order.items.map((item) => `${item.productName} (${lineSelection(item)}) × ${item.quantity}`).join('; ')} · {money(order.totalAmount)} · {order.paymentStatus}{countsForProcurement(order) ? '' : ' · not counted in procurement'}</span></span>
                </label>)}
                {!eligibleOrders.length && <p className="p-3 text-sm text-muted-foreground">No preorder orders are available to attach.</p>}
              </div>
            </label>
            {form.orderIds.length > 0 && <div className="sm:col-span-2"><ProcurementTable orders={(ordersQuery.data ?? []).filter((order) => form.orderIds.includes(order.id))} testId="table-procurement-selected" /></div>}
            {hasArrived && <section className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:col-span-2">
              <p className="text-sm font-bold">Shipping fee per item</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">These fees apply only to preorder products in this batch. Saving recalculates every linked customer's shipping total.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {feeProducts.map((product) => <Field key={product.productId} label={`${product.productName} (GHS each)`} type="number" value={String(form.productFees.find((fee) => fee.productId === product.productId)?.feePerItem ?? '')} onChange={(value) => setForm((current) => ({ ...current, productFees: [...current.productFees.filter((fee) => fee.productId !== product.productId), { ...product, feePerItem: Math.max(0, Number(value) || 0) }] }))} required testId={`input-shipment-fee-${product.productId}`} />)}
                {!feeProducts.length && <p className="text-sm text-muted-foreground sm:col-span-2">Shipping fees can be assigned when preorder orders are linked.</p>}
              </div>
            </section>}
            {(create.isError || update.isError) && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive sm:col-span-2" data-testid="status-shipment-mutation-error">{apiErrorMessage(create.error || update.error, editing ? 'Could not update this shipment. Please try again.' : 'Could not create this shipment. Please try again.')}</p>}
            <label className="sm:col-span-2"><span className="text-sm font-bold">Notes</span><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-input bg-card p-4 text-sm" data-testid="input-shipment-notes" /></label>
            <div className="flex justify-end sm:col-span-2"><button disabled={create.isPending || update.isPending} className="rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60" data-testid="button-save-shipment">{create.isPending || update.isPending ? 'Saving batch…' : 'Save batch'}</button></div>
          </div>
        </form>
      </div>}
  </AdminShell>;
}

function SignInPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} fallbackRedirectUrl={`${basePath}/account`} /></div>;
}

function SignUpPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} fallbackRedirectUrl={`${basePath}/account`} /></div>;
}

const staffPermissions: StaffPermission[] = ['dashboard', 'orders', 'customers', 'payments', 'inventory', 'products', 'shipments', 'promotions', 'content', 'access', 'data-protection'];
function AdminAccess() {
  const access = useCurrentAdminAccess();
  const list = useListStaff({ query: { queryKey: getListStaffQueryKey(), refetchInterval: 30000 } });
  const create = useCreateStaff();
  const update = useUpdateStaff();
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffInput['role']>('manager');
  const [permissions, setPermissions] = useState<StaffPermission[]>(['dashboard', 'orders']);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: getListStaffQueryKey() });
  const toggle = (permission: StaffPermission) => setPermissions((current) => current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]);
  const save = (event: FormEvent) => { event.preventDefault(); if (editing) update.mutate({ id: editing.id, data: { role, permissions } }, { onSuccess: () => { setEditing(null); refresh(); } }); else create.mutate({ data: { email: email.trim(), role, permissions } }, { onSuccess: () => { setEmail(''); refresh(); } }); };
  const startEdit = (member: StaffMember) => { setEditing(member); setRole(member.role === 'owner' ? 'manager' : member.role); setPermissions(member.permissions); };
  return <AdminShell><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow text-primary">Permission access</p><h1 className="serif mt-2 text-4xl font-semibold">Who can operate Ragies?</h1><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Staff must sign up for an account before you add them. Deactivation is recoverable and never deletes the person.</p></div></div>
    <form onSubmit={save} className="mt-8 rounded-2xl bg-card p-5"><p className="font-bold">{editing ? `Edit ${editing.name}` : 'Add a signed-up user'}</p>{!editing && <Field label="Email address" type="email" value={email} onChange={setEmail} required testId="input-staff-email" />}<div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto]"><label><span className="text-sm font-bold">Role</span><select value={role} onChange={(event) => setRole(event.target.value as StaffInput['role'])} className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-3 text-sm" data-testid="select-staff-role">{['manager','operations','sales','catalog','custom'].map((item) => <option value={item} key={item}>{item}</option>)}</select></label><div><span className="text-sm font-bold">Permissions</span><div className="mt-2 flex flex-wrap gap-2">{staffPermissions.map((permission) => <button type="button" key={permission} onClick={() => toggle(permission)} className={`rounded-full px-3 py-2 text-xs font-bold ${permissions.includes(permission) ? 'bg-primary text-primary-foreground' : 'border border-border'}`} data-testid={`button-permission-${permission}`}>{permission}</button>)}</div></div><button className="self-end rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground" disabled={create.isPending || update.isPending} data-testid="button-save-staff">{editing ? 'Save changes' : 'Add staff'}</button></div>{(create.isError || update.isError) && <p className="mt-3 text-sm font-semibold text-destructive">{apiErrorMessage(create.error || update.error, 'We could not save staff access.')}</p>}</form>
    {list.isError ? <div className="mt-6"><QueryError error={list.error} retry={() => list.refetch()} /></div> : list.isLoading ? <div className="skeleton mt-6 h-20 rounded-xl" /> : <StaffList members={list.data ?? []} isOwner={access.data?.role === 'owner'} onEdit={startEdit} togglePending={update.isPending} onToggle={(member) => update.mutate({ id: member.id, data: { active: !member.active } }, { onSuccess: refresh })} onRemoved={(member) => { if (editing?.id === member.id) { setEditing(null); setEmail(''); setRole('manager'); setPermissions(['dashboard', 'orders']); } }} />}
  </AdminShell>;
}

function DataProtection() {
  const summary = useGetDataProtectionSummary({ query: { queryKey: getGetDataProtectionSummaryQueryKey() } });
  const [message, setMessage] = useState('');
  const download = async () => { setMessage('Preparing snapshot…'); try { const snapshot = await exportDataSnapshot(); const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `ragies-data-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); setMessage('Snapshot downloaded successfully.'); } catch (error) { setMessage(apiErrorMessage(error, 'The snapshot could not be downloaded.')); } };
  return <AdminShell><p className="eyebrow text-primary">Data protection</p><h1 className="serif mt-2 text-4xl font-semibold">The store, kept safe.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">A clear view of storage, recovery, and the records currently held by Ragies.</p>{summary.isLoading ? <div className="mt-8 grid gap-4 sm:grid-cols-2"><div className="skeleton h-32 rounded-2xl" /><div className="skeleton h-32 rounded-2xl" /></div> : summary.isError || !summary.data ? <div className="mt-8"><QueryError error={summary.error} retry={() => summary.refetch()} /></div> : <><div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-2xl bg-card p-5"><p className="eyebrow text-muted-foreground">Storage</p><p className="mt-4 text-xl font-bold">{summary.data.database}</p><p className="mt-1 text-sm text-muted-foreground">PostgreSQL database</p></div><div className="rounded-2xl bg-card p-5"><p className="eyebrow text-muted-foreground">Connection</p><p className="mt-4 text-xl font-bold">{summary.data.encryptedConnection ? 'Secure' : 'Review needed'}</p><p className="mt-1 text-sm text-muted-foreground">Encrypted connection</p></div><div className="rounded-2xl bg-card p-5"><p className="eyebrow text-muted-foreground">Production</p><p className="mt-4 text-xl font-bold">{summary.data.automaticProductionBackups && summary.data.pointInTimeRecovery ? 'Backups + PITR' : 'Review needed'}</p><p className="mt-1 text-sm text-muted-foreground">Scheduled recovery coverage</p></div><div className="rounded-2xl bg-card p-5"><p className="eyebrow text-muted-foreground">Development</p><p className="mt-4 text-xl font-bold">{summary.data.developmentCheckpoints ? 'Checkpoints on' : 'Review needed'}</p></div></div><div className="mt-4 grid gap-4 sm:grid-cols-3"><div className="rounded-2xl bg-secondary p-5 text-secondary-foreground"><p className="text-sm opacity-70">Active orders</p><p className="serif mt-2 text-3xl">{summary.data.activeOrders}</p></div><div className="rounded-2xl bg-secondary p-5 text-secondary-foreground"><p className="text-sm opacity-70">Recycle bin orders</p><p className="serif mt-2 text-3xl">{summary.data.softDeletedOrders}</p><Link href="/admin/orders" className="mt-3 inline-flex text-xs font-bold text-accent" data-testid="link-order-recycle-bin">Open order recycle bin</Link></div><div className="rounded-2xl bg-secondary p-5 text-secondary-foreground"><p className="text-sm opacity-70">Products / customers</p><p className="serif mt-2 text-3xl">{summary.data.products} / {summary.data.customers}</p></div></div><div className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-5"><button onClick={() => void download()} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground" data-testid="button-download-snapshot"><Download size={16} /> Download current snapshot</button>{message && <p className="text-sm font-semibold" role="status">{message}</p>}</div><p className="mt-6 rounded-2xl bg-accent/40 p-5 text-sm leading-7"><strong>Recovery note:</strong> {summary.data.recoveryNote}</p></>}</AdminShell>;
}

function FeaturedCategoriesEditor({
  categories, selected, isLoading, error, retry, onChange,
}: {
  categories: Category[] | undefined;
  selected: string[];
  isLoading: boolean;
  error: unknown;
  retry: () => void;
  onChange: (selected: string[]) => void;
}) {
  const bySlug = new Map((categories ?? []).map((category) => [category.slug, category]));
  return <section className="rounded-2xl bg-card p-5" data-testid="homepage-featured-categories">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="serif text-2xl">Featured categories</h2><p className="mt-1 text-sm text-muted-foreground">Choose up to three homepage cards, then set their display order. This does not change the shop categories.</p></div>
      <span className="rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground">{selected.length}/3 selected</span>
    </div>
    {isLoading ? <div className="mt-5 skeleton h-24 rounded-xl" /> : error ? <div className="mt-5"><QueryError error={error} retry={retry} /></div> : !categories?.length ? <p className="mt-5 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Add visible products with categories before featuring them.</p> : <>
      <div className="mt-5 flex flex-wrap gap-2" aria-label="Available product categories">
        {categories.map((category) => {
          const checked = selected.includes(category.slug);
          const disabled = !checked && selected.length >= 3;
          return <button
            key={category.slug}
            type="button"
            aria-pressed={checked}
            disabled={disabled}
            onClick={() => onChange(toggleFeaturedCategory(selected, category.slug))}
            className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${checked ? 'bg-primary text-primary-foreground' : 'border border-border bg-background'}`}
            data-testid={`toggle-feature-category-${category.slug}`}
          >
            {checked && <Check size={15} />}
            {category.name}
            <span className="text-xs opacity-70">{category.count}</span>
          </button>;
        })}
      </div>
      {selected.length > 0 && <ol className="mt-5 space-y-2" aria-label="Homepage category order">
        {selected.map((slug, index) => {
          const category = bySlug.get(slug);
          if (!category) return null;
          return <li key={slug} className="flex items-center gap-3 rounded-xl border border-border bg-background p-3" data-testid={`featured-category-order-${slug}`}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{category.name}</span>
            <button type="button" onClick={() => onChange(moveFeaturedCategory(selected, index, -1))} disabled={index === 0} aria-label={`Move ${category.name} earlier`} className="rounded-full border border-border p-2 disabled:opacity-40" data-testid={`button-feature-category-up-${slug}`}><ArrowUp size={15} /></button>
            <button type="button" onClick={() => onChange(moveFeaturedCategory(selected, index, 1))} disabled={index === selected.length - 1} aria-label={`Move ${category.name} later`} className="rounded-full border border-border p-2 disabled:opacity-40" data-testid={`button-feature-category-down-${slug}`}><ArrowDown size={15} /></button>
            <button type="button" onClick={() => onChange(toggleFeaturedCategory(selected, slug))} aria-label={`Remove ${category.name} from homepage`} className="rounded-full border border-border p-2 text-destructive" data-testid={`button-remove-feature-category-${slug}`}><X size={15} /></button>
          </li>;
        })}
      </ol>}
    </>}
  </section>;
}

function AdminContent() {
  const query = useGetSiteContent({ query: { queryKey: getGetSiteContentQueryKey() } });
  const categories = useListCategories({ query: { ...orderFreshness, queryKey: getListCategoriesQueryKey() } });
  const update = useUpdateSiteContent();
  const client = useQueryClient();
  const [form, setForm] = useState<SiteContent | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => { if (query.data) setForm(query.data); }, [query.data]);
  const selectedFeaturedCategories = resolveFeaturedCategories(form?.featuredCategories, categories.data);
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setStatus('');
    update.mutate({
      data: {
        ...form,
        featuredCategories: form.featuredCategories === null
          ? null
          : resolveFeaturedCategories(form.featuredCategories, categories.data),
      },
    }, {
      onSuccess: () => {
        setStatus('Saved successfully.');
        void client.invalidateQueries({ queryKey: getGetSiteContentQueryKey() });
      },
      onError: (error) => setStatus(apiErrorMessage(error, 'Could not save website content.')),
    });
  };
  const field = (key: keyof SiteContent, label: string, multiline = false) => <label className="block"><span className="text-sm font-bold">{label}</span>{multiline ? <textarea value={String(form?.[key] ?? '')} onChange={(event) => setForm((current) => current ? { ...current, [key]: event.target.value } : current)} rows={4} className="mt-2 w-full rounded-xl border border-input bg-background p-3 text-sm" data-testid={`input-content-${key}`} /> : <input value={String(form?.[key] ?? '')} onChange={(event) => setForm((current) => current ? { ...current, [key]: event.target.value } : current)} className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-3 text-sm" data-testid={`input-content-${key}`} />}</label>;
   return <AdminShell><p className="eyebrow text-primary">Website content</p><h1 className="serif mt-2 text-4xl font-semibold">Keep the storefront current.</h1><p className="mt-2 text-sm text-muted-foreground">Edit the words customers see across Ragies Imports.</p>{query.isError ? <div className="mt-8"><QueryError error={query.error} retry={() => query.refetch()} /></div> : !form ? <div className="mt-8 skeleton h-80 rounded-2xl" /> : <form onSubmit={save} className="mt-8 space-y-5"><section className="rounded-2xl bg-card p-5"><h2 className="serif text-2xl">Home page</h2><div className="mt-5 grid gap-4 sm:grid-cols-2">{field('heroEyebrow', 'Hero eyebrow')}{field('heroTitle', 'Hero title')}{field('heroAccent', 'Hero accent line')}{field('heroDescription', 'Hero description', true)}</div></section><FeaturedCategoriesEditor categories={categories.data} selected={selectedFeaturedCategories} isLoading={categories.isLoading} error={categories.error} retry={() => void categories.refetch()} onChange={(featuredCategories) => setForm((current) => current ? { ...current, featuredCategories } : current)} /><section className="rounded-2xl bg-card p-5"><h2 className="serif text-2xl">About page</h2><div className="mt-5 grid gap-4">{field('aboutTitle', 'About title')}{field('aboutStory', 'Main story paragraph', true)}</div></section><section className="rounded-2xl bg-card p-5"><h2 className="serif text-2xl">Contact and footer</h2><div className="mt-5 grid gap-4 sm:grid-cols-3">{field('contactPhone', 'Phone')}{field('contactLocation', 'Location')}{field('businessHours', 'Business hours')}</div></section><div className="flex flex-wrap items-center gap-4"><button disabled={update.isPending} className="rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground" data-testid="button-save-content">{update.isPending ? 'Saving…' : 'Save website content'}</button>{status && <p role="status" className={`text-sm font-semibold ${update.isError ? 'text-destructive' : 'text-primary'}`}>{status}</p>}</div></form>}</AdminShell>;
}

function AdminDashboardDual() {
  const dashboard = useGetAdminDashboard({ query: { queryKey: getGetAdminDashboardQueryKey() } });
  const rateQuery = useGetExchangeRate({ query: { queryKey: getGetExchangeRateQueryKey() } });
  const updateRate = useUpdateExchangeRate();
  const [rate, setRate] = useState('');
  useEffect(() => { if (rateQuery.data) setRate(String(rateQuery.data.cnyPerGhs)); }, [rateQuery.data]);
  if (dashboard.isLoading || !dashboard.data) return <AdminShell><div className="skeleton h-80 rounded-2xl" /></AdminShell>;
  if (dashboard.isError) return <AdminShell><QueryError error={dashboard.error} retry={() => dashboard.refetch()} /></AdminShell>;
  const summary = dashboard.data;
  const fx = summary.cnyPerGhs || rateQuery.data?.cnyPerGhs || 0.4545;
  const amount = (value: number) => <DualCurrencyAmount amount={value} rate={fx} />;
  return <AdminShell>
     <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow text-primary">Overview</p><h1 className="serif mt-2 text-4xl font-semibold">The pulse of Ragies.</h1></div><p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat('en-GH', { dateStyle: 'full' }).format(new Date())}</p></div>
    <form onSubmit={(event) => { event.preventDefault(); updateRate.mutate({ data: { cnyPerGhs: Number(rate) } }, { onSuccess: () => window.location.reload() }); }} className="mt-6 flex flex-col gap-3 rounded-2xl bg-card p-5 sm:flex-row sm:items-end"><Field label="Yuan per GHS 1" type="number" value={rate} onChange={setRate} required testId="input-cny-rate" /><button className="h-12 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground" disabled={updateRate.isPending}>Save rate</button></form>
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[['Total sales', summary.totalSales], ['Outstanding balance', summary.outstandingBalance], ['Ghana stock sales', summary.ghanaStockSales], ['Pre-order sales', summary.preOrderSales]].map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-card p-5"><p className="text-xs text-muted-foreground">{label}</p><div className="mt-3 text-xl">{amount(Number(value))}</div></div>)}</div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2"><section className="rounded-2xl bg-card p-5"><p className="eyebrow text-primary">Profit and cost</p><div className="mt-5 grid grid-cols-2 gap-4"><div><p className="text-xs text-muted-foreground">Total cost</p><div className="mt-2">{amount(summary.totalCost)}</div></div><div><p className="text-xs text-muted-foreground">Gross profit</p><div className="mt-2">{amount(summary.grossProfit)}</div></div></div><p className="mt-4 text-xs text-muted-foreground">Margin {summary.grossMarginPercentage.toFixed(1)}%</p></section><section className="rounded-2xl bg-secondary p-5 text-secondary-foreground"><p className="eyebrow text-accent">Sales trend</p><div className="mt-4 grid grid-cols-2 gap-4"><div><p className="text-xs opacity-65">This month</p><div className="mt-2">{amount(summary.currentMonthSales)}</div></div><div><p className="text-xs opacity-65">Previous month</p><div className="mt-2">{amount(summary.previousMonthSales)}</div></div></div></section></div>
    <section className="mt-5 rounded-2xl bg-card p-5"><p className="eyebrow text-primary">Monthly performance</p><div className="mt-4 divide-y divide-border">{summary.salesByMonth.map((period) => <div key={period.month} className="grid gap-3 py-3 sm:grid-cols-[1fr_repeat(3,auto)] sm:items-center"><p className="font-semibold">{period.label}</p><span className="text-sm">Sales {amount(period.sales)}</span><span className="text-sm">Cost {amount(period.cost)}</span><span className="text-sm">Profit {amount(period.profit)}</span></div>)}</div></section>
    <div className="mt-5 grid gap-5 lg:grid-cols-2"><section className="rounded-2xl bg-card p-5"><p className="eyebrow text-primary">Best sellers</p><div className="mt-4 divide-y divide-border">{summary.bestSellingProducts.map((product) => <div key={product.productId} className="flex items-center justify-between gap-3 py-3"><span><strong>{product.productName}</strong><small className="block text-xs text-muted-foreground">{product.quantity} sold</small></span>{amount(product.revenue)}</div>)}</div></section><section className="rounded-2xl bg-card p-5"><p className="eyebrow text-primary">Recent orders</p><div className="mt-4 divide-y divide-border">{summary.recentOrders.map((order) => <div key={order.id} className="flex items-center justify-between gap-3 py-3"><span><strong>{order.orderNumber}</strong><small className="block text-xs text-muted-foreground">{order.customerName}</small></span><span className="text-right">{amount(order.totalAmount)}<small className="block text-xs text-muted-foreground">Balance {amount(order.balance)}</small></span></div>)}</div></section></div>
  </AdminShell>;
}

function AdminProductsDual() {
  const products = useListAdminInventory({ query: { queryKey: getListAdminInventoryQueryKey() } });
  const rateQuery = useGetExchangeRate({ query: { queryKey: getGetExchangeRateQueryKey() } });
  const update = useUpdateProduct();
  const client = useQueryClient();
  const [selected, setSelected] = useState<Product | null>(null);
  const [form, setForm] = useState({ name: '', category: '', description: '', price: '', costPrice: '', costCurrency: 'GHS' as 'GHS' | 'CNY', stockQuantity: '', availability: 'ghana-stock', featured: false });
  const edit = (product: Product) => { setSelected(product); setForm({ name: product.name, category: product.category, description: product.description, price: String(product.price), costPrice: product.costPrice == null ? '' : String(product.costPrice), costCurrency: product.costCurrency ?? 'GHS', stockQuantity: String(product.stockQuantity), availability: product.availability, featured: product.featured }); };
  const refresh = () => { void client.invalidateQueries({ queryKey: getListAdminInventoryQueryKey() }); void client.invalidateQueries({ queryKey: getListProductsQueryKey() }); };
  const save = (event: FormEvent) => { event.preventDefault(); if (!selected) return; update.mutate({ id: selected.id, data: { name: form.name, category: form.category, description: form.description, price: Number(form.price), costPrice: form.costPrice ? Number(form.costPrice) : null, costCurrency: form.costCurrency, stockQuantity: Number(form.stockQuantity), availability: form.availability as Product['availability'], featured: form.featured } }, { onSuccess: () => { refresh(); setSelected(null); } }); };
  const rate = rateQuery.data?.cnyPerGhs ?? 0.4545;
  return <AdminShell><p className="eyebrow text-primary">Catalog</p><h1 className="serif mt-2 text-4xl font-semibold">Products and prices.</h1><p className="mt-3 text-sm text-muted-foreground">Every amount is shown in cedis first, with the yuan equivalent underneath.</p><AdminProductForm /><div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{(products.data ?? []).map((product) => <article key={product.id} className="rounded-2xl bg-card p-5"><p className="eyebrow text-muted-foreground">{product.category}</p><h2 className="mt-1 font-bold">{product.name}</h2><div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-background p-3 text-xs"><div><p className="text-muted-foreground">Selling</p><DualCurrencyAmount amount={product.price} rate={rate} className="mt-1" /></div><div><p className="text-muted-foreground">Cost</p>{product.costPrice == null ? <p className="mt-1 font-bold">Not set</p> : <DualCurrencyAmount amount={product.costPrice} sourceCurrency={product.costCurrency ?? 'GHS'} rate={rate} className="mt-1" />}</div></div><button onClick={() => edit(product)} className="mt-4 rounded-full bg-secondary px-4 py-2 text-xs font-bold text-secondary-foreground">Edit product</button></article>)}</div>{selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-secondary/50 p-5"><form onSubmit={save} className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-background p-6"><div className="flex items-center justify-between"><h2 className="serif text-3xl">Edit {selected.name}</h2><button type="button" onClick={() => setSelected(null)}><X /></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} testId="input-dual-name" /><Field label="Category" value={form.category} onChange={(value) => setForm({ ...form, category: value })} testId="input-dual-category" /><Field label="Selling price (GHS)" type="number" value={form.price} onChange={(value) => setForm({ ...form, price: value })} testId="input-dual-price" /><Field label="Cost price" type="number" value={form.costPrice} onChange={(value) => setForm({ ...form, costPrice: value })} testId="input-dual-cost" /><label><span className="text-sm font-bold">Cost currency</span><select value={form.costCurrency} onChange={(event) => setForm({ ...form, costCurrency: event.target.value as 'GHS' | 'CNY' })} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-3 text-sm"><option value="GHS">GHS</option><option value="CNY">CNY</option></select></label><Field label="Stock quantity" type="number" value={form.stockQuantity} onChange={(value) => setForm({ ...form, stockQuantity: value })} testId="input-dual-stock" /><label className="sm:col-span-2"><span className="text-sm font-bold">Description</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-input bg-card p-3 text-sm" /></label></div><button disabled={update.isPending} className="mt-5 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">Save product</button></form></div>}</AdminShell>;
}

function AdminInventoryDual() {
  const inventory = useListAdminInventory({ query: { queryKey: getListAdminInventoryQueryKey() } });
  const rateQuery = useGetExchangeRate({ query: { queryKey: getGetExchangeRateQueryKey() } });
  const update = useUpdateInventory();
  const updateProduct = useUpdateProduct();
  const client = useQueryClient();
  const [selected, setSelected] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState({ availability: 'ghana-stock' as Product['availability'], shipmentId: null as number | null, eta: '', preOrderCloseDate: '' });
  const rate = rateQuery.data?.cnyPerGhs ?? 0.4545;
  const refresh = () => { void client.invalidateQueries({ queryKey: getListAdminInventoryQueryKey() }); void client.invalidateQueries({ queryKey: getListProductsQueryKey() }); void client.invalidateQueries({ queryKey: getGetAdminEtaRemindersQueryKey() }); };
  const startEdit = (product: Product) => { setSelected(product); setEditForm({ availability: product.availability, shipmentId: product.shipmentId ?? null, eta: product.eta ?? '', preOrderCloseDate: product.preOrderCloseDate ?? '' }); updateProduct.reset(); };
  const saveEdit = (event: FormEvent) => { event.preventDefault(); if (!selected) return; updateProduct.mutate({ id: selected.id, data: productEditorPatch(selected, { availability: editForm.availability, shipmentId: editForm.availability === 'pre-order' ? editForm.shipmentId : null, eta: editForm.eta || null, preOrderCloseDate: editForm.preOrderCloseDate || null }) }, { onSuccess: () => { refresh(); setSelected(null); } }); };
  return <AdminShell><p className="eyebrow text-primary">Stock control</p><h1 className="serif mt-2 text-4xl font-semibold">Inventory and prices.</h1><p className="mt-3 text-sm text-muted-foreground">Cedis first, yuan equivalent underneath every amount.</p>{update.isError && <p role="alert" className="mt-4 rounded-xl bg-destructive/5 p-3 text-sm text-destructive">{apiErrorMessage(update.error, 'Inventory could not be updated. Try again.')}</p>}<div className="mt-6 divide-y divide-border overflow-hidden rounded-2xl bg-card">{(inventory.data ?? []).map((product) => <div key={product.id} className="grid gap-4 p-5 sm:grid-cols-[1.5fr_1fr_1fr_auto] sm:items-center"><div><p className="font-bold">{product.name}</p><p className="text-xs text-muted-foreground">{product.category} · {product.stockQuantity} in stock</p>{isQuantified(product.variants) && <p className="mt-1 text-xs text-primary" data-testid={`text-quantified-stock-${product.id}`}>Stock is tracked per size and colour. Edit quantities under Products.</p>}</div><div><p className="text-xs text-muted-foreground">Selling</p><DualCurrencyAmount amount={product.price} rate={rate} className="mt-1" /></div><div><p className="text-xs text-muted-foreground">Cost</p>{product.costPrice == null ? <p className="mt-1 font-bold">Not set</p> : <DualCurrencyAmount amount={product.costPrice} sourceCurrency={product.costCurrency ?? 'GHS'} rate={rate} className="mt-1" />}</div><div className="flex flex-wrap gap-2"><button disabled={update.isPending || isQuantified(product.variants)} title={isQuantified(product.variants) ? 'Edit size and colour quantities on Products' : undefined} onClick={() => update.mutate({ id: product.id, data: { stockAdjustment: 1 } }, { onSuccess: refresh })} className="rounded-full border border-border px-3 py-2 text-xs font-bold disabled:opacity-50" data-testid={`button-stock-add-${product.id}`}>+ stock</button><button disabled={update.isPending || product.stockQuantity <= 0 || isQuantified(product.variants)} title={isQuantified(product.variants) ? 'Edit size and colour quantities on Products' : undefined} onClick={() => update.mutate({ id: product.id, data: { stockAdjustment: -1 } }, { onSuccess: refresh })} className="rounded-full border border-border px-3 py-2 text-xs font-bold disabled:opacity-50" data-testid={`button-stock-remove-${product.id}`}>− stock</button><button disabled={update.isPending} onClick={() => update.mutate({ id: product.id, data: { hidden: !product.hidden } }, { onSuccess: refresh })} className="rounded-full border border-border px-3 py-2 text-xs font-bold disabled:opacity-50">{product.hidden ? 'Restore' : 'Hide'}</button><button type="button" onClick={() => startEdit(product)} className="rounded-full bg-secondary px-3 py-2 text-xs font-bold text-secondary-foreground" data-testid={`button-inventory-edit-${product.id}`}>Edit product</button></div></div>)}</div>{selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-secondary/50 p-5"><form onSubmit={saveEdit} className="w-full max-w-xl rounded-3xl bg-background p-6"><div className="flex items-center justify-between"><h2 className="serif text-3xl">Edit {selected.name}</h2><button type="button" onClick={() => setSelected(null)} aria-label="Close edit product"><X /></button></div><div className="mt-5 space-y-4"><AvailabilityBatchControl availability={editForm.availability} shipmentId={editForm.shipmentId} onChange={(availability, shipmentId) => setEditForm((current) => ({ ...current, availability, shipmentId }))} testId="inventory-edit-availability" />{editForm.availability === 'pre-order' && <><InheritedClosingField shipmentId={editForm.shipmentId} rawDate={editForm.preOrderCloseDate} onChange={(value) => setEditForm({ ...editForm, preOrderCloseDate: value })} testId="inventory-edit-close-date" /><InheritedEtaField shipmentId={editForm.shipmentId} rawEta={editForm.eta} onChange={(value) => setEditForm({ ...editForm, eta: value })} testId="inventory-edit-eta" /></>}</div><button disabled={updateProduct.isPending || (editForm.availability === 'pre-order' && !editForm.shipmentId)} className="mt-5 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">{updateProduct.isPending ? 'Saving…' : 'Save product'}</button>{updateProduct.isError && <p role="alert" className="mt-3 text-sm text-destructive">{apiErrorMessage(updateProduct.error, 'Could not update this product.')}</p>}</form></div>}</AdminShell>;
}

function AdminProductsWithImages() {
  const products = useListAdminInventory({ query: { ...orderFreshness, queryKey: getListAdminInventoryQueryKey() } });
  const shipments = useListProductBatches({ query: { queryKey: getListProductBatchesQueryKey() } });
  const rateQuery = useGetExchangeRate({ query: { queryKey: getGetExchangeRateQueryKey() } });
  const update = useUpdateProduct();
  const client = useQueryClient();
  const [selected, setSelected] = useState<Product | null>(null);
  const [deletionMessage, setDeletionMessage] = useState('');
  const [form, setForm] = useState({
    name: '', category: '', description: '', price: '', costPrice: '',
    costCurrency: 'GHS' as 'GHS' | 'CNY', stockQuantity: '',
    availability: 'ghana-stock' as 'ghana-stock' | 'pre-order', shipmentId: null as number | null, featured: false, eta: '', preOrderCloseDate: '',
  });
  const [options, setOptions] = useState<OptionsState>({ colors: '', sizes: '', variants: '', matrix: '', stockQuantity: '' });
  const [optionError, setOptionError] = useState('');
  const rate = rateQuery.data?.cnyPerGhs ?? 0.4545;
  const edit = (product: Product) => {
    setSelected(product);
    setForm({
      name: product.name,
      category: product.category,
      description: product.description,
      price: String(product.price),
      costPrice: product.costPrice == null ? '' : String(product.costPrice),
      costCurrency: product.costCurrency ?? 'GHS',
      stockQuantity: String(product.stockQuantity),
      availability: product.availability,
      shipmentId: product.shipmentId ?? null,
      featured: product.featured,
      eta: product.eta ?? '',
      preOrderCloseDate: product.preOrderCloseDate ?? '',
    });
    setOptions(optionsFromProduct(product));
    setOptionError('');
  };
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getListAdminInventoryQueryKey() });
    void client.invalidateQueries({ queryKey: getListProductsQueryKey() });
    void client.invalidateQueries({ queryKey: getListShipmentsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetAdminEtaRemindersQueryKey() });
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const built = buildOptionsPayload(options);
    if (!built.ok) { setOptionError(built.errors[0]); return; }
    setOptionError('');
    const originalOptions = optionsFromProduct(selected);
    const optionsChanged = (Object.keys(options) as Array<keyof OptionsState>)
      .some((key) => options[key] !== originalOptions[key]);
    update.mutate({
      id: selected.id,
      data: productEditorPatch(selected, {
        name: form.name,
        category: form.category,
        description: form.description,
        price: Number(form.price),
        costPrice: form.costPrice ? Number(form.costPrice) : null,
        costCurrency: form.costCurrency,
        ...(optionsChanged ? built.data : {}),
        availability: form.availability as Product['availability'],
        shipmentId: form.availability === 'pre-order' ? form.shipmentId : null,
        featured: form.featured,
        eta: form.eta || null,
        preOrderCloseDate: form.preOrderCloseDate || null,
      }),
    }, { onSuccess: () => { refresh(); setSelected(null); } });
  };
  return (
    <AdminShell>
      <p className="eyebrow text-primary">Catalog</p>
      <h1 className="serif mt-2 text-4xl font-semibold">Products and prices.</h1>
      <p className="mt-3 text-sm text-muted-foreground">Every amount is shown in cedis first, with the yuan equivalent underneath.</p>
      <AdminProductForm />
      {deletionMessage && <p role="status" className="mt-5 rounded-xl border border-border bg-card p-4 text-sm font-semibold">{deletionMessage}</p>}
      {products.isError && <div className="mt-6"><QueryError error={products.error} retry={() => products.refetch()} /></div>}
      {products.isLoading && <div className="skeleton mt-6 h-64 rounded-2xl" />}
      {products.isSuccess && !products.data.length && <div className="mt-6 rounded-2xl border border-dashed border-border p-8 text-center" data-testid="empty-admin-products"><Package className="mx-auto text-primary" /><h2 className="mt-3 font-bold">No products in the catalog</h2><p className="mt-2 text-sm text-muted-foreground">Add your real products using the form above.</p></div>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(products.data ?? []).map((product) => (
          <article key={product.id} className="overflow-hidden rounded-2xl bg-card">
            <div className="aspect-[4/3] bg-muted">
              {product.images[0] ? (
                <img src={product.images[0]} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Package size={34} strokeWidth={1.5} />
                  <span className="text-xs font-semibold">No image</span>
                </div>
              )}
            </div>
            <div className="p-5">
              <p className="eyebrow text-muted-foreground">{product.category}</p>
              <h2 className="mt-1 font-bold">{product.name}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2"><Availability availability={product.availability} />{product.availability === 'pre-order' && (product.shipmentId == null ? <span className="text-xs font-semibold text-destructive" data-testid={`warning-unassigned-product-${product.id}`}>Legacy pre-order · no batch assigned</span> : <span className="text-xs text-muted-foreground" data-testid={`label-product-batch-${product.id}`}>Batch: {shipments.data?.find((shipment) => shipment.id === product.shipmentId)?.name ?? `#${product.shipmentId}`}</span>)}</div>
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-background p-3 text-xs">
                <div><p className="text-muted-foreground">Selling</p><DualCurrencyAmount amount={product.price} rate={rate} className="mt-1" /></div>
                <div><p className="text-muted-foreground">Cost</p>{product.costPrice == null ? <p className="mt-1 font-bold">Not set</p> : <DualCurrencyAmount amount={product.costPrice} sourceCurrency={product.costCurrency ?? 'GHS'} rate={rate} className="mt-1" />}</div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => edit(product)} className="min-h-11 flex-1 rounded-full bg-secondary px-4 py-2 text-xs font-bold text-secondary-foreground" data-testid={`button-edit-product-${product.id}`}>Edit product</button>
                <ProductDeleteButton product={product} onDeleted={(name) => setDeletionMessage(`${name} was permanently deleted from the catalog and storefront.`)} />
              </div>
            </div>
          </article>
        ))}
      </div>
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-secondary/50 p-5">
          <form onSubmit={save} className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-background p-6">
            <div className="flex items-center justify-between"><h2 className="serif text-3xl">Edit {selected.name}</h2><button type="button" onClick={() => setSelected(null)} aria-label="Close edit product"><X /></button></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} testId="input-dual-image-name" />
              <Field label="Category" value={form.category} onChange={(value) => setForm({ ...form, category: value })} testId="input-dual-image-category" />
              <Field label="Selling price (GHS)" type="number" value={form.price} onChange={(value) => setForm({ ...form, price: value })} testId="input-dual-image-price" />
              <Field label="Cost price" type="number" value={form.costPrice} onChange={(value) => setForm({ ...form, costPrice: value })} testId="input-dual-image-cost" />
              <label><span className="text-sm font-bold">Cost currency</span><select value={form.costCurrency} onChange={(event) => setForm({ ...form, costCurrency: event.target.value as 'GHS' | 'CNY' })} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-3 text-sm"><option value="GHS">GHS</option><option value="CNY">CNY</option></select></label>
              <div className="sm:col-span-2"><AvailabilityBatchControl availability={form.availability} shipmentId={form.shipmentId} onChange={(availability, shipmentId) => setForm((current) => ({ ...current, availability, shipmentId }))} testId="edit-product-availability" /></div>
              {form.availability === 'pre-order' && <><InheritedClosingField shipmentId={form.shipmentId} rawDate={form.preOrderCloseDate} onChange={(value) => setForm({ ...form, preOrderCloseDate: value })} testId="input-edit-product-close-date" /><InheritedEtaField shipmentId={form.shipmentId} rawEta={form.eta} onChange={(value) => setForm({ ...form, eta: value })} testId="input-edit-product-eta" /></>}
              <ProductOptionsFields prefix="edit-product" value={options} onChange={(next) => { setOptionError(''); setOptions(next); }} />
              <label className="sm:col-span-2"><span className="text-sm font-bold">Description</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-input bg-card p-3 text-sm" /></label>
            </div>
            <button disabled={update.isPending || (form.availability === 'pre-order' && !form.shipmentId)} className="mt-5 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">{update.isPending ? 'Saving…' : 'Save product'}</button>
            {optionError && <p role="alert" className="mt-3 text-sm text-destructive" data-testid="error-edit-product-options">{optionError}</p>}
            {update.isError && <p role="alert" className="mt-3 text-sm text-destructive">{apiErrorMessage(update.error, 'Could not update this product.')}</p>}
          </form>
        </div>
      )}
    </AdminShell>
  );
}

function useCurrentAdminAccess() {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  return useGetAdminAccess({
    query: {
      queryKey: [...getGetAdminAccessQueryKey(), userId, sessionId],
      enabled: Boolean(isLoaded && isSignedIn),
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      refetchInterval: 30000,
      retry: (count, error) => ![401, 403].includes((error as ApiErrorLike).status ?? 0) && count < 1,
    },
  });
}

function AdminGuard({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  const access = useCurrentAdminAccess();
  if (!isLoaded) return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><div className="skeleton h-10 w-40 rounded-full" /></div>;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  if (access.isLoading) return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><div className="skeleton h-10 w-56 rounded-full" /></div>;
  if (access.isError) { const status = (access.error as ApiErrorLike)?.status; if (status === 403) return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5 text-center"><div className="max-w-md rounded-3xl bg-card p-8"><ShieldCheck className="mx-auto text-destructive" /><h1 className="serif mt-4 text-3xl font-semibold">This desk is permissioned</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Your account is signed in, but it has not been granted access to Ragies operations.</p><Link href="/" className="mt-6 inline-flex rounded-full bg-secondary px-5 py-3 text-sm font-bold text-secondary-foreground">Return to storefront</Link></div></div>; return <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-5 text-center"><QueryError error={access.error} retry={() => access.refetch()} /></div>; }
  if (!access.isSuccess || !access.data?.active) return <Redirect to="/" />;
  const panels: Record<string, StaffPermission> = { '/admin': 'dashboard', '/admin/orders': 'orders', '/admin/inventory': 'inventory', '/admin/customers': 'customers', '/admin/products': 'products', '/admin/promotions': 'promotions', '/admin/shipments': 'shipments', '/admin/content': 'content', '/admin/access': 'access', '/admin/data-protection': 'data-protection' };
  panels['/admin/sms'] = 'orders';
  const dateViewPermissions: StaffPermission[] = ['dashboard', 'shipments', 'products', 'orders'];
  const canViewDates = access.data.permissions.some((panel) => dateViewPermissions.includes(panel));
  const permission = panels[location];
  if ((location === '/admin/dates' && !canViewDates) || (location !== '/admin/dates' && (!permission || !access.data.permissions.includes(permission)))) {
    const destination = Object.entries(panels).find(([, panel]) => access.data.permissions.includes(panel));
    if (location === '/admin' && destination) return <Redirect to={destination[0]} />;
    return <AdminShell><div className="rounded-2xl bg-card p-6"><h1 className="text-2xl font-bold">Panel access restricted</h1><p className="mt-3 text-sm">Your staff permissions do not include this panel. Choose an allowed panel from the navigation, or ask an owner to update your access.</p></div></AdminShell>;
  }
  return <>{children}</>;
}

function ProtectedAdmin() {
  return <AdminGuard><AdminDashboardDual /></AdminGuard>;
}

function ProtectedAdminOrders() {
  return <AdminGuard><AdminOrders /></AdminGuard>;
}

function ProtectedAdminProducts() {
  return <AdminGuard><AdminProductsWithImages /></AdminGuard>;
}
function ProtectedAdminInventory() {
  return <AdminGuard><AdminInventoryDual /></AdminGuard>;
}
function ProtectedAdminCustomers() {
  return <AdminGuard><Customers /></AdminGuard>;
}

function ProtectedAdminShipments() {
  return <AdminGuard><OperationsShipments /></AdminGuard>;
}
function ProtectedAdminDates() {
  return <AdminGuard><AdminShell><StaffEtaAlerts /></AdminShell></AdminGuard>;
}
function ProtectedAdminPromotions() {
  return <AdminGuard><AdminPromotions /></AdminGuard>;
}
function ProtectedAdminAccess() { return <AdminGuard><AdminAccess /></AdminGuard>; }
function ProtectedDataProtection() { return <AdminGuard><DataProtection /></AdminGuard>; }
function ProtectedAdminContent() { return <AdminGuard><AdminContent /></AdminGuard>; }

function Router() {
  const [location] = useLocation();
  if (location === '/admin/sms') return <ErrorBoundary resetKey={location}><AdminGuard><AdminShell><SmsNotificationsPanel /></AdminShell></AdminGuard></ErrorBoundary>;
  if (location === '/admin/content') return <ErrorBoundary resetKey={location}><ProtectedAdminContent /></ErrorBoundary>;
  if (location === '/admin/content') return <ErrorBoundary resetKey={location}><ProtectedAdminContent /></ErrorBoundary>;
  return <ErrorBoundary resetKey={location}><Switch><Route path="/" component={Home} /><Route path="/shop" component={Shop} /><Route path="/promotions" component={Promotions} /><Route path="/product/:id" component={ProductPage} /><Route path="/checkout" component={Checkout} /><Route path="/order-confirmation/:orderNumber" component={Confirmation} /><Route path="/track-order" component={TrackOrder} /><Route path="/account/orders" component={Account} /><Route path="/account" component={Account} /><Route path="/about" component={About} /><Route path="/sign-in/*?" component={SignInPage} /><Route path="/sign-up/*?" component={SignUpPage} /><Route path="/admin/orders" component={ProtectedAdminOrders} /><Route path="/admin/inventory" component={ProtectedAdminInventory} /><Route path="/admin/customers" component={ProtectedAdminCustomers} /><Route path="/admin/products" component={ProtectedAdminProducts} /><Route path="/admin/promotions" component={ProtectedAdminPromotions} /><Route path="/admin/shipments" component={ProtectedAdminShipments} /><Route path="/admin/dates" component={ProtectedAdminDates} /><Route path="/admin/access" component={ProtectedAdminAccess} /><Route path="/admin/data-protection" component={ProtectedDataProtection} /><Route path="/admin" component={ProtectedAdmin} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function SessionQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  useEffect(() => () => {
    void client.cancelQueries();
    client.clear();
  }, [client]);
  return <QueryClientProvider client={client}><PaystackReturnRefresh /><DeletedAccountSessionRecovery />{children}</QueryClientProvider>;
}

function DeletedAccountSessionRecovery() {
  const queryClient = useQueryClient();
  const { isSignedIn, userId } = useAuth();
  const { signOut } = useStorefrontSignOut();
  const [, setLocation] = useLocation();
  const handling = useRef(false);

  useEffect(() => {
    handling.current = false;
    if (!isSignedIn || !userId) return;
    const recover = (error: unknown) => {
      if (handling.current || !isMissingAccountSessionError(error)) return;
      handling.current = true;
      void queryClient.cancelQueries();
      queryClient.clear();
      setLocation('/sign-in', { replace: true });
      // The sign-out hook also removes this session's cart. Clear query data first,
      // so no subsequent screen can render stale account or staff information.
      void signOut(`${basePath}/sign-in`);
    };
    const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        recover(event.query.state.error);
      }
    });
    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.mutation.state.status === 'error') {
        recover(event.mutation.state.error);
      }
    });
    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
    };
  }, [isSignedIn, userId, queryClient, setLocation, signOut]);

  return null;
}

function SessionApp() {
  const { isLoaded, userId, sessionId } = useAuth();
  if (!isLoaded) return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><div className="skeleton h-10 w-40 rounded-full" /></div>;
  return <SessionQueryProvider key={`${userId ?? 'guest'}:${sessionId ?? 'none'}`}><Router /></SessionQueryProvider>;
}

function ClerkApp() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={{
    theme: shadcn,
    cssLayerName: 'clerk',
    options: { logoPlacement: 'inside', logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/ragies-logo.png` },
    variables: {
      colorPrimary: '#b65016',
      colorForeground: '#20274b',
      colorMutedForeground: '#62666f',
      colorDanger: '#ad3730',
      colorBackground: '#f8f4ec',
      colorInput: '#fffdf8',
      colorInputForeground: '#20274b',
      colorNeutral: '#d9d0c2',
      fontFamily: 'DM Sans, sans-serif',
      borderRadius: '1rem',
    },
    elements: {
      rootBox: 'w-full flex justify-center',
      cardBox: 'bg-[#f8f4ec] rounded-2xl w-[440px] max-w-full overflow-hidden',
      card: '!shadow-none !border-0 !bg-transparent !rounded-none',
      footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
      headerTitle: 'text-[#20274b] font-semibold',
      headerSubtitle: 'text-[#62666f]',
      socialButtonsBlockButtonText: 'text-[#20274b]',
      formFieldLabel: 'text-[#20274b]',
      footerActionLink: 'text-[#a94714] font-semibold',
      footerActionText: 'text-[#62666f]',
      dividerText: 'text-[#62666f]',
      formButtonPrimary: 'bg-[#b65016] hover:bg-[#9f4112] text-white',
      formFieldInput: 'bg-[#fffdf8] border-[#d9d0c2] text-[#20274b]',
      logoBox: 'mb-2',
      logoImage: 'object-contain',
      main: 'gap-5',
    },
  }} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{
    signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to manage your account and orders' } },
    signUp: { start: { title: 'Create your account', subtitle: 'Save your orders and shop with Ragies Imports' } },
  }} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <CartProvider><SessionApp /></CartProvider>
  </ClerkProvider>;
}

function App() {
  return <WouterRouter base={basePath}><ClerkApp /></WouterRouter>;
}
export default App;