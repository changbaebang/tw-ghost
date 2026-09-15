import clsx from 'clsx';

const size = 'lg';

export function App({ active }: { active: boolean }) {
  return (
    <div className="text-sm text-m p-4 p-3 z-10 md:hover:text-sm !p-4 -m-4 -m-3 w-1/2 w-[13px]">
      <div className={`swiper-slide text-acme ${active ? 'bg-acme-light' : 'text-smm'} text-sm`}>
        template literal
      </div>
      <button className={clsx('rounded-lg', 'z-nav', { 'text-sm': active })}>clsx</button>
      <span className={`text-${size}`}>dynamic (never a candidate)</span>
    </div>
  );
}
