'use client';
import { FC, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import Link from 'next/link';

export const MenuItem: FC<{
  label: string;
  icon: ReactNode;
  path: string;
  onClick?: () => void;
  onNavigate?: () => void;
}> = ({ label, icon, path, onClick, onNavigate }) => {
  const currentPath = usePathname();
  const isActive = currentPath === path || currentPath.startsWith(path + '/');

  const className = clsx(
    'relative flex min-h-[40px] w-full shrink-0 items-center gap-[9px] rounded-[8px] px-[10px] text-start text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-btnPrimary mobile:min-h-[44px]',
    isActive
      ? 'bg-boxHover font-semibold text-newTextColor before:absolute before:inset-y-[8px] before:start-0 before:w-[2px] before:rounded-full before:bg-btnPrimary'
      : 'text-textItemBlur hover:bg-boxHover hover:text-newTextColor'
  );

  const inner = (
    <>
      <span
        aria-hidden="true"
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center [&_svg]:max-h-full [&_svg]:max-w-full"
      >
        {icon}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          onClick();
        }}
        title={label}
        className={className}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      prefetch={true}
      href={path}
      onNavigate={onNavigate}
      title={label}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      {...(path.indexOf('http') === 0 && { target: '_blank' })}
      className={className}
    >
      {inner}
    </Link>
  );
};
