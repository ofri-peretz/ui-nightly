export default { title: 'Layout' };

export const Responsive = {
  render: () => `<div class="pad"><div class="grid">${[1, 2, 3, 4, 5, 6].map((n) => `<div class="tile">Tile ${n}</div>`).join('')}</div></div>`,
};
