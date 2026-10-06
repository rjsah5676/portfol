export default function Header() {
  return (
    <div
      id="site-header"
      className="flex flex-col items-center gap-4 bg-[#121212] px-6 pt-36 pb-20 text-center"
    >
      <span className="font-mono text-sm text-[#8B84FF]">{"// fullstack developer"}</span>
      <h1 className="font-mono text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
        Gunmo&apos;s Dev Life
      </h1>
    </div>
  );
}
