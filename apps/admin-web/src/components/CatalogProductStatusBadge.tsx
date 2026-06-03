import {
  catalogProductFrozenSublabel,
  catalogProductStatusBadgeClass,
  catalogProductStatusLabel,
  isCatalogProductStatus,
  type CatalogProductFrozenSource,
  type CatalogProductStatus,
} from '@voicex/shared';

type Props = {
  status: string;
  frozenSource?: CatalogProductFrozenSource | null;
  className?: string;
  /** Use block layout for badge + sublabel stacked (table cells). */
  stacked?: boolean;
};

export function CatalogProductStatusBadge({
  status,
  frozenSource = null,
  className = '',
  stacked = false,
}: Props) {
  const resolved: CatalogProductStatus = isCatalogProductStatus(status) ? status : 'inactive';
  const sublabel = catalogProductFrozenSublabel(resolved, frozenSource);

  const badge = (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${catalogProductStatusBadgeClass(resolved)} ${className}`}
    >
      {catalogProductStatusLabel(resolved)}
    </span>
  );

  if (!sublabel) return badge;

  if (stacked) {
    return (
      <span className="inline-flex flex-col items-center gap-0.5">
        {badge}
        <span className="text-[10px] font-medium text-gray-500">{sublabel}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      {badge}
      <span className="text-[10px] font-medium text-gray-500">{sublabel}</span>
    </span>
  );
}
