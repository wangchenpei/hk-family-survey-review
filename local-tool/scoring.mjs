const AXES = ['H', 'S', 'A'];
const NAMES = { H: '香港身份', S: '香港升学', A: '保险及资产配置' };
const item = (q, field, max, values) => ({ q, field, label: q, max, values });

// 题号按当前21题腾讯问卷对应。分值沿用已确认的V1规则。
const H = [
  item('Q8', 'identity', 15, [10, 15, 10, 0, 0]),
  item('Q9', 'interest', 20, [15, 15, 20, 0, 0]),
  item('Q10', 'education', 10, [10, 10, 5, 3]),
  item('Q11', 'work', 17.5, [17.5, 12, 5, 0]),
  item('Q12', 'renewal', 17.5, [17.5, 5]),
  item('Q14', 'identityBudget', 10, [5, 8, 10, 7, 0]),
  item('Q16', 'decision', 10, [10, 7, 4]),
];
const S = [
  item('Q1', 'stage', 10, [10, 10, 7, 0]),
  item('Q2', 'curriculum', 5, [5, 5, 5, 5, 0, 0]),
  item('Q3', 'grade', 10, [10, 10, 6, 2, 0, 0]),
  item('Q4', 'english', 10, [10, 7, 3, 3]),
  item('Q5', 'goal', 15, [15, 15, 15, 0, 0]),
  item('Q7', 'move', 15, [15, 12, 5, 7]),
  item('Q8', 'identity', 5, [5, 5, 5, 0, 0]),
  item('Q13', 'schoolBudget', 15, [3, 7, 12, 15, 10]),
  item('Q15', 'cost', 5, [3, 5, 4]),
  item('Q16', 'decision', 5, [5, 3.5, 2]),
];
const A = [
  item('Q6', 'route', 20, [12, 8, 15, 12, 12, 5]),
  item('Q9', 'interest', 35, [5, 30, 35, 0]),
  item('Q13', 'schoolBudget', 20, [4, 9, 16, 20, 12]),
  item('Q15', 'cost', 5, [3, 5, 4]),
  item('Q16', 'decision', 20, [20, 14, 8]),
];

export function checkRules(rules) { return rules; }
export function classify(score, thresholds = { A: 80, B: 60, C: 40 }) {
  return score >= thresholds.A ? 'A' : score >= thresholds.B ? 'B' : score >= thresholds.C ? 'C' : 'D';
}

function indexFor(answer, field, fields, optionIndexes) {
  const suppliedIndex = optionIndexes?.[field];
  if (Number.isInteger(suppliedIndex) && suppliedIndex >= 0) return suppliedIndex;
  return (fields.find((entry) => entry.id === field)?.options || []).indexOf(answer);
}
function itemsFor(axis) { return axis === 'H' ? H : axis === 'S' ? S : A; }

export function analyze(answers, rules, fields = [], optionIndexes = {}, rawAnswers = {}) {
  const dimensions = {};
  const scores = {};
  const pendingByQuestion = new Map();
  const questionField = new Map([...H, ...S, ...A].map((rule) => [rule.q, rule.field]));
  const choice = (question) => {
    const field = questionField.get(question);
    return field ? indexFor(answers[field], field, fields, optionIndexes) : -1;
  };

  for (const axis of AXES) {
    const scoringItems = itemsFor(axis);
    const details = scoringItems.map((rule) => {
      const answer = String(answers[rule.field] || '').trim();
      const choiceIndex = indexFor(answer, rule.field, fields, optionIndexes);
      const valid = Boolean(answer) && choiceIndex >= 0 && choiceIndex < rule.values.length;
      const points = valid ? (rule.values[choiceIndex] ?? 0) : 0;
      const field = fields.find((entry) => entry.id === rule.field);
      const raw = String(rawAnswers[rule.field] ?? answer).trim();
      const displayAnswer = raw.replace(/^[A-Z][.．、]\s*/, '');

      if (!valid) {
        const message = `${rule.q}「${field?.label || rule.field}」${answer ? '答案无法识别' : '缺少答案'}，待核实`;
        pendingByQuestion.set(rule.q, message);
      }

      return {
        field: rule.field,
        label: rule.q,
        max: rule.max,
        points,
        answer: valid ? displayAnswer : '未提供',
        rule: `${rule.q}选项映射`,
        reason: valid ? (points === rule.max ? '按配置规则计满分' : '按该答案映射计分') : '答案无法识别，计0分并待核实',
      };
    });
    const rawPoints = details.reduce((sum, detail) => sum + detail.points, 0);
    let factor = 1;
    const adjustmentReasons = [];
    if (axis === 'H') {
      if (choice('Q8') === 2 && choice('Q12') === 1 && choice('Q14') === 4) {
        factor = Math.min(factor, 0.3);
        adjustmentReasons.push('Q8=C、Q12=B、Q14=E，保留30%');
      }
      if (choice('Q5') === 3 && choice('Q7') === 2 && choice('Q9') === 0 && choice('Q11') === 2) {
        factor = Math.min(factor, 0.7);
        adjustmentReasons.push('Q5=D、Q7=C、Q9=A、Q11=C，保留70%');
      }
      if (choice('Q8') === 3 && choice('Q9') === 3 && choice('Q14') === 4) {
        factor = 0;
        adjustmentReasons.push('Q8=D、Q9=D、Q14=E，H分归零');
      }
    } else if (axis === 'S') {
      if (choice('Q5') === 3 && choice('Q6') !== 1 && choice('Q8') !== 2) {
        factor = Math.min(factor, 0.2);
        adjustmentReasons.push('Q5=D、Q6≠B、Q8≠C，保留20%');
      }
      if (choice('Q6') === 5) {
        const byQ3 = [1, 0.8, 0.5, 0.3][choice('Q3')];
        if (byQ3 !== undefined) {
          factor = Math.min(factor, byQ3);
          adjustmentReasons.push(`Q6=F、Q3=${String.fromCharCode(65 + choice('Q3'))}，保留${byQ3 * 100}%`);
        }
      }
      if (choice('Q4') === 2) {
        const byQ1 = choice('Q1') <= 1 ? 1 : choice('Q1') === 2 ? 0.5 : choice('Q1') === 3 ? 0.2 : undefined;
        if (byQ1 !== undefined) {
          factor = Math.min(factor, byQ1);
          adjustmentReasons.push(`Q4=C、Q1=${String.fromCharCode(65 + choice('Q1'))}，保留${byQ1 * 100}%`);
        }
      }
    } else {
      if (choice('Q9') === 0) {
        factor = 0.5;
        adjustmentReasons.push('Q9=A，保留50%');
      } else if (choice('Q9') === 3) {
        factor = 0.3;
        adjustmentReasons.push('Q9=D，保留30%');
      }
    }
    const total = Math.round(rawPoints * factor * 10) / 10;
    scores[axis] = total;
    dimensions[axis] = [{
      name: NAMES[axis],
      max: scoringItems.reduce((sum, rule) => sum + rule.max, 0),
      points: total,
      rawPoints,
      adjustment: factor < 1 ? { factor, reasons: adjustmentReasons } : null,
      items: details,
    }];
  }

  const sortedScores = AXES.map((axis) => scores[axis]).sort((a, b) => b - a);
  const composite = Math.round((sortedScores[0] * 0.6 + sortedScores[1] * 0.25 + sortedScores[2] * 0.15) * 10) / 10;
  const level = AXES.filter((axis) => scores[axis] >= 80).length >= 2 ? 'A' : classify(composite);
  const highest = Math.max(...AXES.map((axis) => scores[axis]));
  const main = AXES.filter((axis) => scores[axis] >= 40 && highest - scores[axis] < 10);
  const focus = AXES.filter((axis) => scores[axis] >= 80);

  return {
    scores,
    dimensions,
    composite,
    level,
    main,
    focus,
    route: main.map((axis) => NAMES[axis]).join('、') || '暂无明确主业务',
    priority: ['A', 'B'].includes(level),
    pending: [...pendingByQuestion.values()],
    next: level === 'A' ? '优先安排联合需求确认' : level === 'B' ? '安排咨询并补齐待核实资料' : '补齐资料后重新评估',
    version: 'HSA-v1.0.0',
  };
}
