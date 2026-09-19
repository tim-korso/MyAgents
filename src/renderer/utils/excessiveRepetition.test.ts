import { describe, expect, it } from 'vitest';

import { detectExcessiveRepetition } from './excessiveRepetition';

function makePseudoRandomCjk(length: number): string {
  const chars = '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处理府研色';
  let seed = 1;
  const out: string[] = [];
  while (out.length < length) {
    seed = (seed * 48271) % 0x7fffffff;
    out.push(chars[seed % chars.length]);
  }
  return out.join('');
}

describe('detectExcessiveRepetition', () => {
  it('detects delimiter-free IME duplication after a non-repeated file reference prefix', () => {
    const repeated =
      '请帮我分析这个文件里的接口调用链路为什么会在第三方输入法提交之后被重复写入很多次';
    const text = `@docs/report.md ${repeated.repeat(40)}`;

    expect(detectExcessiveRepetition(text)).toBeGreaterThanOrEqual(5);
  });

  it('detects repeated multi-segment prose even when no single segment covers the payload', () => {
    const repeated = '先看日志，再看输入框状态，然后给出最小修复方案。';
    const text = repeated.repeat(12);

    expect(detectExcessiveRepetition(text)).toBeGreaterThanOrEqual(5);
  });

  it('detects longer repeated bodies after a non-repeated file reference prefix', () => {
    const repeated = makePseudoRandomCjk(520);
    const text = `@docs/report.md ${repeated.repeat(5)}`;

    expect(repeated.length).toBeGreaterThan(500);
    expect(detectExcessiveRepetition(text)).toBeGreaterThanOrEqual(5);
  });

  it('detects large repeated bodies when copy boundaries are not aligned to a sampler stride', () => {
    const repeated = makePseudoRandomCjk(11_999);
    const text = `@docs/report.md ${repeated.repeat(5)}`;

    expect(text.length).toBeGreaterThan(60_000);
    expect(detectExcessiveRepetition(text)).toBeGreaterThanOrEqual(5);
  });

  it('does not flag ordinary long prose without a dominant repeated block', () => {
    const text = [
      '这是一段普通的长文本，用来描述输入框在不同状态下的行为变化。',
      '用户可能先引用文件，再补充问题背景，随后说明期望的输出格式。',
      '每个句子都有不同的内容和结构，不应该被重复检测误认为输入法故障。',
      '即使文本整体超过两百个字符，只要没有同一段内容占据主要比例，就应当直接发送。',
      '这里继续补充一些与前文不同的说明，覆盖中文标点、英文 words，以及数字 2026。',
      '最后一段收束场景：这类内容更像正常需求描述，而不是同一句话被连续写入很多遍。',
    ].join('\n');

    expect(detectExcessiveRepetition(text)).toBe(0);
  });
});
