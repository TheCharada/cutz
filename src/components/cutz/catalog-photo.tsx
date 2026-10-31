import Image from "next/image";

export function CatalogPhoto({
  src, name, className = "size-20",
}: {
  src: string | null;
  name: string;
  className?: string;
}) {
  const style = `${className} shrink-0 rounded-xl object-cover`;
  if (src) {
    return <Image src={src} alt="" width={96} height={96} unoptimized className={style} />;
  }
  return (
    <span
      className={`${style} flex items-center justify-center bg-muted text-xl font-semibold text-muted-foreground`}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
