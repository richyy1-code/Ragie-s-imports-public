type BrandLogoProps = {
  className?: string;
  framed?: boolean;
};

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const logoUrl = `${basePath}/ragies-logo.png`;

export function BrandLogo({ className = 'h-12 w-28', framed = false }: BrandLogoProps) {
  const image = <img src={logoUrl} alt="Ragies Imports" className={`brand-logo-image ${className}`} />;
  return framed
    ? <span className="brand-logo-frame p-1.5">{image}</span>
    : image;
}