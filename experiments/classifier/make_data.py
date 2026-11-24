"""2차 피해(secondary) · 카드(card) 판단 모델용 [예시] 데이터 만들기.

라벨: secondary, card ∈ {yes, no, none}
  yes  = 그 피해가 있다 (secondary: 스미싱·사칭·명의도용·무단 결제 등 / card: 카드 정보 유출·카드 피해)
  no   = 그 피해가 없다고 말한다 ("안 왔어요", "괜찮대요")
  none = 그 피해와 관계없는 문장
모르겠다("있는지 모르겠어요")는 이 세 라벨에 넣지 않았다(규칙 쪽 unknown이 맡음).

모든 문장은 직접 만든 [예시] 문장이다. 실제 피해자 글 · 실제 회사 이름 · 개인정보를 쓰지 않는다.
회사 이름은 기호(○○쇼핑 등)만 쓴다.

씨앗 문장 문법
  [A|B|C]   단어 · 말투 바꾸기 (하나를 고름)
  {co}      회사 이름 기호, {card}는 카드사 기호
  {co:을}   회사 이름 뒤 조사를 받침에 맞게 (을/를, 이/가, 은/는, 와/과, 으로/로)
  texts가 여러 개면 어순 바꾸기
같은 씨앗의 변형은 학습/검증/평가 중 한쪽에만 들어간다.

실행: python experiments/classifier/make_data.py  → data/classifier/{train,val,test}.json
"""
import itertools
import json
import random
import re
from collections import Counter
from pathlib import Path

RANDOM_SEED = 20261125
PER_SEED = 8  # 씨앗 하나에서 만드는 최대 변형 수
SPLIT = {'train': 0.70, 'val': 0.15, 'test': 0.15}
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'data' / 'classifier'

COMPANIES = ['○○쇼핑', '△△통신사', '◇◇은행', '☆☆여행사', '○○마트', '△△병원', '□□몰']
CARD_COMPANIES = ['□□카드사', '◇◇카드', '△△카드사']
ENDINGS = ['.', '', '!', ' ㅠㅠ']  # 말투(문장 끝) 바꾸기

# (secondary, card, texts)
SEEDS = [
    # ── secondary yes ──
    ('yes', 'none', ['유출 안내를 받은 뒤로 [스미싱 문자|택배 사칭 문자|이상한 링크 문자]가 [세 번|여러 번|몇 번] [왔어요|왔습니다|왔음|왔네요]',
                     '[스미싱 문자|택배 사칭 문자|이상한 링크 문자]가 유출 안내 받고 나서 [세 번|여러 번] [왔어요|왔습니다]']),
    ('yes', 'none', ['{co} 유출 이후로 [보이스피싱 전화|검찰 사칭 전화|사칭 전화]를 [두 번|몇 차례|여러 번] [받았어요|받았습니다|받았음|받았다]']),
    ('yes', 'none', ['[제 이름으로|내 이름으로|제 명의로] 결제 시도가 [있었어요|있었습니다|있었음|있었대요]',
                     '누가 [제 이름으로|내 명의로] 결제를 [시도했어요|시도했습니다|시도했음]']),
    ('yes', 'none', ['[모르는 사이에|어느 날 보니] 제 명의로 [휴대폰이 개통됐어요|대출이 신청됐어요|계좌가 만들어졌어요|휴대폰이 개통됐습니다]']),
    ('yes', 'none', ['스미싱 문자가 [끊임없이|쉴 새 없이|하루가 멀다 하고] [와요|왔어요|오고 있어요|옵니다]',
                     '[끊임없이|쉴 새 없이] 스미싱 문자가 [와요|들어와요|오고 있습니다]']),
    ('yes', 'none', ['이상한 문자가 [적지 않게|꽤 많이|한두 번이 아니게] [왔어요|왔습니다|왔음]']),
    ('yes', 'none', ['스미싱 문자[뿐만 아니라|에다가|는 물론이고] 보이스피싱 전화까지 [왔어요|받았어요|왔습니다]']),
    ('yes', 'none', ['[요즘|유출 이후로] 스팸 문자가 안 오는 날이 [없어요|없습니다|없네요]',
                     '스팸 문자가 [하루도 빠짐없이|빠짐없이 매일] [와요|옵니다]']),
    ('yes', 'none', ['[택배 조회|배송 확인|미납 요금] 링크가 담긴 문자가 [왔는데|왔고] [누르지는 않았어요|바로 지웠어요|신고했어요]']),
    ('yes', 'none', ['[유출 안내 받고|그 일 이후로] [모르는 번호|해외 번호]로 [이상한 전화|수상한 전화]가 [계속|자꾸] [와요|옵니다|오네요]']),
    ('yes', 'none', ['{co:을} 사칭한 문자를 [받았어요|받았습니다|받았음]',
                     '[링크가 달린|URL이 있는] 문자가 왔는데 {co:을} 사칭한 거였어요']),
    ('yes', 'none', ['가족한테 제 이름으로 [돈 보내 달라는|급하게 송금해 달라는] 메시지가 [갔대요|갔다고 해요|갔습니다]']),
    ('yes', 'none', ['제 계좌에서 [모르는 이체가|무단 이체가] [있었어요|있었습니다|확인됐어요]',
                     '[모르는 이체가|무단 이체가] 제 계좌에서 [빠져나갔어요|있었어요]']),
    ('yes', 'none', ['[해외 사이트|모르는 사이트]에서 제 [아이디로|계정으로] 로그인 시도 알림이 [왔어요|떴어요|왔습니다]']),
    ('yes', 'none', ['[{co} 직원을|택배 기사를|경찰을] 사칭한 [전화|문자]가 [왔어요|왔습니다|왔음]']),
    ('yes', 'none', ['[문자 속 링크를|이상한 링크를] [눌렀다가|잘못 눌렀다가] [이상한 앱이 깔렸어요|악성 앱이 설치됐어요]']),
    ('yes', 'none', ['[제 번호로|제 이름으로] [모르는 사이트|쇼핑몰]에 가입된 걸 [알았어요|확인했어요|발견했어요]']),
    ('yes', 'none', ['[중고거래|오픈마켓] 사기에 제 [이름이|명의가] [쓰였대요|도용됐대요|사용됐대요]']),
    ('yes', 'none', ['[유출 뒤로|그 뒤로] 스팸 [문자가|전화가] [확 늘었어요|부쩍 늘었어요|엄청 와요]']),
    ('yes', 'none', ['[정부 지원금을|건강검진 결과를|과태료 안내를] 가장한 [문자|링크]가 [왔어요|왔습니다|와요]']),
    # ── secondary yes · card yes ──
    ('yes', 'yes', ['[제 카드로|카드로] [해외 결제가|모르는 결제가|이상한 결제가] [됐어요|승인됐어요|됐습니다|잡혔어요]',
                    '[해외 결제가|모르는 결제가] 제 카드로 [승인됐어요|됐습니다]']),
    ('yes', 'yes', ['{card}에서 [제 카드가|카드가] 부정 사용됐다고 [연락이 왔어요|전화가 왔어요|알려줬어요]']),
    ('yes', 'yes', ['[카드 정보가 유출된 뒤로|카드번호가 털리고 나서] [이상한 결제 문자가|결제 승인 문자가] [왔어요|왔습니다|날아왔어요]']),
    ('yes', 'yes', ['제가 쓰지 않은 [카드 결제|카드 승인] 내역이 [있었어요|찍혀 있었어요|확인됐어요]']),
    ('yes', 'yes', ['카드번호가 유출돼서 [누가 그 카드로|그 카드로 누가] [게임 아이템을 샀어요|결제를 했어요|해외 직구를 했어요]']),
    # ── card yes ──
    ('none', 'yes', ['{card}에서 [재발급하라는|카드를 재발급해 준다는|재발급 안내] [연락이|전화가|문자가] [왔어요|왔습니다|옴]',
                     '[재발급하라는|재발급 안내] [연락이|전화가] {card}에서 [왔어요|왔습니다]']),
    ('none', 'yes', ['[유출된 정보에|유출 항목에] [카드번호가|카드 정보가|신용카드 번호가] [포함됐대요|들어 있대요|있었어요|포함되어 있습니다]']),
    ('none', 'yes', ['[카드 정보도|카드번호도] 같이 [털렸어요|유출됐어요|새어 나갔대요]']),
    ('none', 'yes', ['{co}에 등록해 둔 [카드 정보|결제 카드]까지 [유출됐다고 합니다|유출됐대요|나갔대요]']),
    ('none', 'yes', ['[카드 유효기간|CVC 번호]까지 [유출됐대요|털렸다고 해요|유출됐습니다]']),
    ('none', 'yes', ['결국 [카드를 정지하고 재발급|카드를 새로 발급] [받았어요|받았습니다|받음]']),
    ('none', 'yes', ['{card}에서 [카드 정보가 유출됐을 수 있으니|유출 대상이라고] 재발급하라고 [했어요|안내했어요|하더라고요]']),
    # ── secondary no ──
    ('no', 'none', ['스미싱 문자는 [안 왔어요|아직 안 왔어요|안 왔습니다|오지 않았어요]',
                    '[아직|다행히] 스미싱 문자는 [안 왔어요|오지 않았어요]']),
    ('no', 'none', ['[아직까지|지금까지는] [별다른 피해는|추가 피해는|2차 피해는] [없어요|없습니다|없었어요|없음]']),
    ('no', 'none', ['[다행히|아직은] [이상한 문자는|수상한 전화는] [없었어요|안 받았어요|오지 않았어요]']),
    ('no', 'none', ['[보이스피싱|사칭] 전화는 [받은 적 없어요|한 번도 안 왔어요|못 받았어요]']),
    ('no', 'none', ['[유출 안내만|안내 문자만] 받았고 [다른 피해는|그 뒤로 이상한 일은] [없었어요|없어요]']),
    ('no', 'none', ['[명의 도용은|도용 피해는] [없는 것 같아요|확인되지 않았어요|아직 없대요]']),
    ('no', 'none', ['[통장|계좌]에서 빠져나간 돈은 [없어요|없었습니다|하나도 없어요]']),
    ('no', 'none', ['[지금까지|아직] 아무 일도 [없었어요|일어나지 않았어요|없네요]']),
    ('no', 'none', ['[걱정했는데|조마조마했는데] [아무 연락도|이상한 연락은] [안 왔어요|없었어요]']),
    ('no', 'none', ['[결제 시도|이상 결제] 같은 건 [전혀|아직] [없었어요|없어요|없습니다]']),
    ('no', 'none', ['[스팸이 늘거나 하진|딱히 달라진 건] [않았어요|없어요|없습니다]']),
    # ── card no ──
    ('none', 'no', ['카드는 [괜찮대요|안전하대요|괜찮다고 했어요|문제없대요]',
                    '[다행히|그나마] 카드는 [괜찮대요|안전하대요]']),
    ('none', 'no', ['[카드 정보는|카드번호는] [유출되지 않았대요|유출 안 됐대요|포함 안 됐대요|포함되지 않았다고 합니다]']),
    ('none', 'no', ['[결제 정보는|카드 정보는] [암호화돼 있어서|따로 보관돼서] [안전하다고 했어요|유출되지 않았대요]']),
    ('none', 'no', ['[카드사에 확인해 보니|카드사에 물어보니] 제 카드는 [이상 없대요|문제없대요|괜찮대요]']),
    ('none', 'no', ['[카드번호는|카드 정보는] 이번 유출 [대상이 아니래요|대상에서 빠졌대요|범위에 없대요]']),
    # ── secondary no · card no ──
    ('no', 'no', ['이상한 문자는 [없었고|안 왔고] 카드는 [괜찮대요|안전하대요]',
                  '카드는 [괜찮대요|안전하대요]. 이상한 문자도 [없었어요|안 왔어요]']),
    ('no', 'no', ['[스미싱도|2차 피해도] 없고 카드 정보도 [유출되지 않았어요|안 나갔대요]']),
    ('no', 'no', ['카드는 [괜찮다고 하고|안전하다고 하고] 아직 [피해도 없어요|이상한 연락도 없어요]']),
    # ── 섞인 문장 ──
    ('no', 'yes', ['[스미싱 문자는 안 왔는데|아직 이상한 문자는 없지만] [카드번호가|카드 정보가] [유출됐대요|털렸대요]']),
    ('no', 'yes', ['{card}에서 재발급 [연락을|안내를] 받았지만 [이상 결제는|부정 사용은] [없었어요|아직 없어요]']),
    ('yes', 'no', ['카드는 괜찮다는데 [스미싱 문자가|사칭 문자가] [계속 와요|두 번 왔어요|왔어요]',
                   '[스미싱 문자가|사칭 문자가] [계속 와요|왔어요]. 카드는 [괜찮대요|안전하대요]']),
    ('yes', 'no', ['[보이스피싱 전화는|사칭 전화는] [받았지만|왔지만] 카드 정보는 [유출되지 않았대요|안전하대요]']),
    ('no', 'yes', ['[2차 피해는 아직 없지만|별다른 피해는 없는데] [카드 유효기간까지|카드번호까지] [유출됐대요|털렸대요|유출됐습니다]']),
    ('no', 'yes', ['[유출 항목에 카드번호가 있었지만|카드 정보가 같이 나갔지만] [스미싱 문자는|이상한 연락은] [아직 안 왔어요|없었어요|없습니다]']),
    ('no', 'yes', ['[이상한 전화는 없었는데|사칭 문자는 안 왔는데] {card}에서 카드를 재발급하라고 [연락이 왔어요|안내했어요|하더라고요]']),
    ('yes', 'no', ['[제 명의로 결제 시도가 있었는데|누가 제 이름으로 결제를 시도했는데] 카드 정보는 [유출 안 됐대요|안전하대요|괜찮대요]']),
    ('yes', 'no', ['[카드번호는 이번 유출 대상이 아니래요|카드번호는 포함되지 않았대요]. 그런데 [택배 사칭 문자가|이상한 링크 문자가] [세 번 왔어요|계속 와요]']),
    ('yes', 'no', ['[카드사에 물어보니 카드는 이상 없다는데|카드는 문제없다는데] [보이스피싱 전화가|검찰 사칭 전화가] [두 번 왔어요|자꾸 와요|계속 옵니다]']),
    # ── 관계없는 문장 ──
    # 재발급 안내가 없다는 건 카드가 안전하다는 뜻이 아니다(검수 반영) → card=none
    ('none', 'none', ['[카드사 재발급 연락은|재발급 안내는] [없었어요|안 왔어요|받지 않았어요]']),
    ('none', 'none', ['[오늘|어제] [날씨가 좋네요|하늘이 맑아요|비가 많이 왔어요]']),
    ('none', 'none', ['{co}에서 [개인정보 유출 안내|유출 공지] [문자를|메일을] [받았어요|받았습니다|봤어요]']),
    ('none', 'none', ['[이름이랑 주소가|이름, 연락처, 주소가|전화번호와 이메일이] [유출됐대요|유출됐습니다|털렸대요]']),
    ('none', 'none', ['{co} [고객센터에|콜센터에] 전화했는데 [연결이 안 돼요|계속 통화 중이에요|아무도 안 받아요]']),
    ('none', 'none', ['[어디에 신고해야 할지|어떻게 대응해야 할지] [모르겠어요|궁금해요|알려 주세요]']),
    ('none', 'none', ['[카드사 앱에서|카드사 홈페이지에서] [포인트를 확인했어요|이번 달 명세서를 봤어요|할인 쿠폰을 받았어요]']),
    ('none', 'none', ['[택배 도착 알림이|배송 완료 안내가] [문자로|카톡으로] 왔는데 제가 주문한 거였어요']),
    ('none', 'none', ['[친구도|동생도] {co} 회원이라 [같이 확인해 봤어요|같이 알아봤어요]']),
    ('none', 'none', ['[비밀번호를 바로|비밀번호를 전부] [바꿨어요|변경했어요|바꿨습니다]']),
    ('none', 'none', ['{co}에서 [사과문을|사과 공지를] [올렸어요|발표했어요|냈어요]']),
    ('none', 'none', ['[단체 소송에|공동 대응에] [참여하고 싶어요|관심이 있어요|같이하고 싶습니다]']),
    ('none', 'none', ['[피해 보상이|보상 절차가] [언제 되는지|어떻게 되는지] [모르겠어요|궁금합니다]']),
    ('none', 'none', ['[카드값이|이번 달 카드값이] [많이 나왔어요|생각보다 많네요|좀 나왔어요]']),
    ('none', 'none', ['[안내 문자가|연락이] [안 와서|없어서] [유출된 줄 몰랐어요|늦게 알았어요]']),
    ('none', 'none', ['[유출 안내 문자는|유출 안내는] [끊임없이|여러 번] 왔는데 [내용이 똑같아요|다 같은 내용이에요]']),
    ('none', 'none', ['[은행 앱|카드 앱] [업데이트가|로그인이] [안 돼요|느려요|자꾸 튕겨요]']),
    ('none', 'none', ['{co:은} [유출 경위를|원인을] [조사 중이래요|아직 밝히지 않았어요]']),
]

JOSA = {'을': ('을', '를'), '이': ('이', '가'), '은': ('은', '는'), '과': ('과', '와'), '으로': ('으로', '로')}


def has_batchim(word):
    ch = word[-1]
    if not ('가' <= ch <= '힣'):
        return False
    return (ord(ch) - 0xAC00) % 28 != 0


def expand(template):
    """[A|B] 바꾸기를 모두 펼친다."""
    parts = re.split(r'(\[[^\]]+\])', template)
    options = [p[1:-1].split('|') if p.startswith('[') else [p] for p in parts]
    return [''.join(c) for c in itertools.product(*options)]


def fill(text, rng):
    co = rng.choice(COMPANIES)
    card = rng.choice(CARD_COMPANIES)

    def josa(m):
        name = co if m.group(1) == 'co' else card
        if not m.group(2):
            return name
        a, b = JOSA[m.group(2)]
        if m.group(2) == '으로':
            last = name[-1]
            use_a = has_batchim(name) and (ord(last) - 0xAC00) % 28 != 8  # ㄹ받침은 '로'
            return name + (a if use_a else b)
        return name + (a if has_batchim(name) else b)

    # {co:을} → 이름+조사, {co} → 이름. 한 문장 안에서는 같은 회사를 쓴다.
    return re.sub(r'\{(co|card)(?::([^}]+))?\}', josa, text)


def variants(texts, rng):
    pool = [t for tpl in texts for t in expand(tpl)]
    rng.shuffle(pool)
    out, seen = [], set()
    for t in pool:
        s = fill(t, rng) + rng.choice(ENDINGS)
        s = s.strip()
        if s not in seen:
            seen.add(s)
            out.append(s)
        if len(out) >= PER_SEED:
            break
    return out


def split_seeds(seeds, sizes, rng):
    """같은 씨앗의 변형은 한쪽에만. 문장 수 기준 70/15/15에 맞춘다.
    1) 씨앗이 3개 이상인 라벨 조합은 평가·검증에 씨앗을 1개씩 먼저 넣는다(조합마다 평가에 들어가게).
    2) 나머지 씨앗은 그 조합 안에서 목표 비율보다 가장 모자란 쪽에 넣되, 검증·평가는 전체 목표를 넘기지 않는다."""
    by_combo = {}
    for i, (sec, card, _) in enumerate(seeds):
        by_combo.setdefault((sec, card), []).append(i)
    assign, count, combo_count, rest = {}, Counter(), Counter(), []
    for combo, ids in sorted(by_combo.items()):
        ids = ids[:]
        rng.shuffle(ids)
        ids.sort(key=lambda i: sizes[i])  # 먼저 넣는 씨앗은 작은 것으로 (비율이 덜 흔들리게)
        if len(ids) >= 3:
            for name, i in zip(['test', 'val'], ids):
                assign[i] = name
                count[name] += sizes[i]
                combo_count[combo, name] += sizes[i]
            ids = ids[2:]
        rest += ids
    rng.shuffle(rest)
    rest.sort(key=lambda i: -sizes[i])  # 큰 씨앗부터 (같은 크기는 섞인 순서)
    total = sum(sizes)
    combo_total = Counter()
    for i, (sec, card, _) in enumerate(seeds):
        combo_total[sec, card] += sizes[i]
    for i in rest:
        combo = seeds[i][:2]
        # 그 조합 안에서 목표보다 가장 모자란 쪽 → 같으면 전체에서 가장 모자란 쪽
        # 검증·평가는 전체 목표를 넘지 않을 때만 후보
        room = [n for n in SPLIT if n == 'train' or count[n] + sizes[i] <= SPLIT[n] * total]
        name = max(room, key=lambda n: ((SPLIT[n] * combo_total[combo] - combo_count[combo, n]) / SPLIT[n],
                                        (SPLIT[n] * total - count[n]) / SPLIT[n]))
        assign[i] = name
        count[name] += sizes[i]
        combo_count[combo, name] += sizes[i]
    return assign


def main():
    rng = random.Random(RANDOM_SEED)
    # 문장을 먼저 만들고(씨앗마다 문장 수를 알아야 비율을 맞출 수 있다) 씨앗 단위로 나눈다
    seen, per_seed = set(), []
    for sec, card, texts in SEEDS:
        kept = [t for t in variants(texts, rng) if not (t in seen or seen.add(t))]
        per_seed.append(kept)
    assign = split_seeds(SEEDS, [len(v) for v in per_seed], rng)
    data = {'train': [], 'val': [], 'test': []}
    for i, ((sec, card, _), texts) in enumerate(zip(SEEDS, per_seed)):
        for j, text in enumerate(texts):
            data[assign[i]].append({'id': f's{i:03d}-{j}', 'seed': i, 'text': text,
                                    'secondary': sec, 'card': card, 'example': True})

    OUT.mkdir(parents=True, exist_ok=True)
    for name, items in data.items():
        doc = {'note': '[예시] 직접 만든 문장. 실제 피해자 글·회사·개인정보 아님. 회사 이름은 기호만.',
               'labels': {'secondary': ['yes', 'no', 'none'], 'card': ['yes', 'no', 'none']},
               'split': name, 'random_seed': RANDOM_SEED, 'count': len(items), 'items': items}
        (OUT / f'{name}.json').write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    # 검사: 씨앗이 두 쪽에 걸치지 않는다
    where = {}
    for name, items in data.items():
        for it in items:
            assert where.setdefault(it['seed'], name) == name, it
    total = sum(len(v) for v in data.values())
    print(f'씨앗 {len(SEEDS)}개 → 문장 {total}개')
    print_report(data, rng)


def print_report(data, rng):
    names = ['train', 'val', 'test']
    print('\n| 라벨 | ' + ' | '.join(names) + ' | 합계 |')
    print('|---|' + '---:|' * (len(names) + 1))
    for field in ['secondary', 'card']:
        for lab in ['yes', 'no', 'none']:
            row = [sum(1 for it in data[n] if it[field] == lab) for n in names]
            print(f'| {field}={lab} | ' + ' | '.join(map(str, row)) + f' | {sum(row)} |')
    row = [len(data[n]) for n in names]
    seeds = [len({it['seed'] for it in data[n]}) for n in names]
    print('| 문장 수 | ' + ' | '.join(map(str, row)) + f' | {sum(row)} |')
    print('| 씨앗 수 | ' + ' | '.join(map(str, seeds)) + f' | {sum(seeds)} |')
    print('| 비율 | ' + ' | '.join(f'{r / sum(row):.0%}' for r in row) + ' | |')

    combos = {n: Counter((it['secondary'], it['card']) for it in data[n]) for n in names}
    seed_of = {n: Counter((it['secondary'], it['card']) for it in {x['seed']: x for x in data[n]}.values()) for n in names}
    print('\n| secondary / card | ' +' | '.join(names) + ' | 합계 |')
    print('|---|' + '---:|' * (len(names) + 1))
    for k in sorted(set().union(*combos.values())):
        cells = [f'{combos[n][k]} ({seed_of[n][k]})' for n in names]
        print(f'| {k[0]} / {k[1]} | ' + ' | '.join(cells) + f' | {sum(combos[n][k] for n in names)} |')
    print('(괄호: 씨앗 수)')

    allv = [it for n in names for it in data[n]]
    print('\n무작위 샘플 20개')
    for it in random.Random(7).sample(allv, 20):
        split = next(n for n in names if it in data[n])
        print(f"- [{split}] sec={it['secondary']:<4} card={it['card']:<4} | {it['text']}")


if __name__ == '__main__':
    main()
