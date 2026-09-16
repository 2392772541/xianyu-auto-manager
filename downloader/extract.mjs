// Runs in the product page; only reads the rendered document.
export function extractProduct() {
  const description = document.querySelector('span[class^="desc--"]')?.innerText?.trim() || '';
  const thumbs = [...document.querySelectorAll('[class*="item-main-window-list-item"] img')];
  const slides = [...document.querySelectorAll('[class*="carouselItem"] img')];
  const key = s => s.replace(/_(?:\d+x\d+)?Q\d+.*$|_\d+x\d+.*$/,'');
  const order = [...new Set((thumbs.length ? thumbs : slides).map(e=>key(e.src)))];
  const candidates = [...document.querySelectorAll('img')].map(e=>e.src).filter(Boolean);
  const rank = u => /_Q\d+/.test(u) ? 100000 : Number(u.match(/_(\d+)x/)?.[1] || 0);
  const images = order.map(k=>candidates.filter(u=>key(u)===k).sort((a,b)=>rank(b)-rank(a))[0]);
  return {id:new URL(location.href).searchParams.get('id'),url:location.href,description,
    title:description.split('\n')[0] || document.title,images,expected:order.length,
    expanded:![...document.querySelectorAll('span,div')].some(e=>e.children.length===0&&e.textContent.trim()==='展开'&&e.getBoundingClientRect().height>0)};
}
