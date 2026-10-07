/**
 * Monta um PDF simples com uma imagem JPEG por página, ocupando a página inteira.
 * É o formato que o LinkedIn usa para carrossel ("documento"). Não depende de biblioteca externa:
 * o JPEG entra direto no PDF (filtro DCTDecode).
 */

/** Largura e altura de um JPEG, lidas do cabeçalho (marcador SOF). */
export function tamanhoDoJpeg(buffer) {
  let i = 2;
  while (i < buffer.length) {
    if (buffer[i] !== 0xff) {
      i++;
      continue;
    }
    const marcador = buffer[i + 1];
    const tamanho = buffer.readUInt16BE(i + 2);
    if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) {
      return { altura: buffer.readUInt16BE(i + 5), largura: buffer.readUInt16BE(i + 7) };
    }
    i += 2 + tamanho;
  }
  throw new Error('Imagem JPEG inválida para o PDF.');
}

export function montarPdf(jpegs) {
  if (!jpegs.length) throw new Error('Nenhuma imagem para o PDF.');
  const partes = [];
  const deslocamentos = [];
  let tamanho = 0;
  const escrever = (dado) => {
    const b = Buffer.isBuffer(dado) ? dado : Buffer.from(dado, 'latin1');
    partes.push(b);
    tamanho += b.length;
  };
  const objeto = (numero, corpo) => {
    deslocamentos[numero] = tamanho;
    escrever(`${numero} 0 obj\n`);
    for (const pedaco of [].concat(corpo)) escrever(pedaco);
    escrever('\nendobj\n');
  };

  escrever('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const paginas = jpegs.map((_, i) => 3 + i * 3);
  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objeto(2, `<< /Type /Pages /Kids [${paginas.map((n) => `${n} 0 R`).join(' ')}] /Count ${jpegs.length} >>`);
  jpegs.forEach((jpeg, i) => {
    const { largura, altura } = tamanhoDoJpeg(jpeg);
    const pagina = 3 + i * 3;
    const imagem = pagina + 1;
    const desenho = pagina + 2;
    objeto(pagina, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${largura} ${altura}] /Resources << /XObject << /Im${i} ${imagem} 0 R >> >> /Contents ${desenho} 0 R >>`);
    objeto(imagem, [
      `<< /Type /XObject /Subtype /Image /Width ${largura} /Height ${altura} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
      '\nendstream',
    ]);
    const comandos = `q ${largura} 0 0 ${altura} 0 0 cm /Im${i} Do Q`;
    objeto(desenho, `<< /Length ${comandos.length} >>\nstream\n${comandos}\nendstream`);
  });

  const total = 3 + jpegs.length * 3;
  const inicioXref = tamanho;
  escrever(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) escrever(`${String(deslocamentos[n]).padStart(10, '0')} 00000 n \n`);
  escrever(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);
  return Buffer.concat(partes);
}
