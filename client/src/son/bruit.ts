/**
 * Bruit rose (filtre de Paul Kellet), généré une fois : la matière du brouhaha, des
 * consonnes, des percussions et des pas. Bouclable sans clic (fondu sur les bords).
 */
export function bruitRose(ctx: BaseAudioContext, secondes: number, alea: () => number = Math.random): AudioBuffer {
  const tampon = ctx.createBuffer(1, Math.floor(ctx.sampleRate * secondes), ctx.sampleRate);
  const d = tampon.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const blanc = alea() * 2 - 1;
    b0 = 0.99886 * b0 + blanc * 0.0555179;
    b1 = 0.99332 * b1 + blanc * 0.0750759;
    b2 = 0.969 * b2 + blanc * 0.153852;
    b3 = 0.8665 * b3 + blanc * 0.3104856;
    b4 = 0.55 * b4 + blanc * 0.5329522;
    b5 = -0.7616 * b5 - blanc * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + blanc * 0.5362) * 0.11;
    b6 = blanc * 0.115926;
  }
  // Raccord sans clic quand le tampon boucle : fondu sur les bords.
  const bord = Math.min(2000, d.length >> 2);
  for (let i = 0; i < bord; i++) {
    d[i]! *= i / bord;
    d[d.length - 1 - i]! *= i / bord;
  }
  return tampon;
}
