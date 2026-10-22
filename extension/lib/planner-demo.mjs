import { addDays, weekOf, slotKey } from './planner-model.mjs';

export const RESTAURANTS = [
  { id: 'kooy', group: 'University dorms', name: 'خوابگاه کوی · سلف اصلی', shortName: 'کوی', color: '#47745c', quotaGroup: 'student' },
  { id: 'building6', group: 'University dorms', name: 'خوابگاه · ساختمان ۶', shortName: 'ساختمان ۶', color: '#537e8e', quotaGroup: 'student' },
  { id: 'engineering', group: 'Campus dining', name: 'دانشکده فنی · امیرآباد', shortName: 'فنی', color: '#bb7352', quotaGroup: 'student' },
  { id: 'central', group: 'Campus dining', name: 'پردیس مرکزی · سلف مهمان', shortName: 'سلف مهمان', color: '#948044', quotaGroup: 'student' },
  { id: 'garden', group: 'Supplementary restaurants', name: 'رستوران مکمل · باغ', shortName: 'باغ', color: '#8272a6', quotaGroup: 'supplement' },
  { id: 'corner', group: 'Supplementary restaurants', name: 'رستوران مکمل · کنج', shortName: 'کنج', color: '#ae6483', quotaGroup: 'supplement' },
  { id: 'market', group: 'Dorm shops', name: 'فروشگاه · مجتمع کوی', shortName: 'فروشگاه کوی', color: '#4f819f', quotaGroup: null },
];

const LUNCHES = ['چلو خورش قورمه سبزی', 'زرشک پلو با مرغ', 'چلوکباب کوبیده', 'لوبیا پلو با گوشت', 'چلو خورش بادمجان', 'چلو اکبر جوجه'];
const DINNERS = ['خوراک مرغ سوخاری', 'چلو خورش قیمه', 'ماکارونی با قارچ', 'کشک بادمجان', 'چلو جوجه کباب', 'خوراک کوردن بلو'];
const SECONDS = ['خوراک کوکو سیب زمینی', 'خوراک آبگوشت', 'آش جو با نان', 'خوراک دلمه فلفل', 'خوراک همبرگر', 'خوراک ناگت مرغ'];

// Fictional menus and policies. This adapter has no fetch, credentials, or dining URL.
export class DemoDiningService {
  constructor({ today, saved, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), delayMs = 650 }) {
    this.today = today;
    this.currentWeek = weekOf(today);
    this.wait = wait;
    this.delayMs = delayMs;
    this.failNextSave = false;
    this.failNextRead = false;
    this.balanceRials = saved?.balanceRials ?? 4_200_000;
    this.bookings = new Set(saved?.bookings ?? [
      this.foods('kooy', this.currentWeek).find(choice => choice.date === today && choice.mealId === '1')?.id,
      this.foods('kooy', addDays(this.currentWeek, 7))[0]?.id,
    ].filter(Boolean));
  }

  foods(restaurantId, week) {
    const restaurant = RESTAURANTS.find(item => item.id === restaurantId);
    const weekDistance = Math.round((Date.parse(week) - Date.parse(this.currentWeek)) / (7 * 86_400_000));
    if (!restaurant || weekDistance > 1 || weekDistance < -8) return [];
    const choices = [];
    for (let day = 0; day < 7; day++) for (const mealId of ['1', '3']) {
      if (restaurant.quotaGroup === 'student' && (day === 6 || (day === 5 && mealId === '3'))) continue;
      if (['engineering', 'central'].includes(restaurantId) && mealId === '3') continue;
      const date = addDays(week, day);
      const single = restaurant.quotaGroup !== 'student';
      for (let food = 0; food < (single ? 1 : 2); food++) {
        const name = restaurantId === 'market' ? 'پک میوه و میان‌وعده'
          : single ? `غذای روز · ${mealId === '1' ? LUNCHES[day % 6] : DINNERS[day % 6]}`
            : food ? SECONDS[(day + (mealId === '3' ? 2 : 0)) % 6]
              : (mealId === '1' ? LUNCHES : DINNERS)[day % 6];
        const locked = date < addDays(this.today, 2);
        choices.push({ id: `${restaurantId}:${date}:${mealId}:${food}`, restaurantId, week, date, mealId, name,
          priceRials: restaurantId === 'market' ? 180_000 : single ? 1_200_000 : food ? 250_000 : 350_000,
          locked, lockReason: locked ? 'The reservation deadline has passed.' : '' });
      }
    }
    return choices;
  }

  async readMenu(restaurantId, week) {
    await this.wait(this.delayMs + (restaurantId.length % 3) * 150);
    if (this.failNextRead) { this.failNextRead = false; throw new Error('Could not load this menu. Try again.'); }
    const choices = this.foods(restaurantId, week);
    return { restaurantId, week, choices, reservedIds: choices.filter(choice => this.bookings.has(choice.id)).map(choice => choice.id),
      published: week <= addDays(this.currentWeek, 7) && week >= addDays(this.currentWeek, -56) };
  }

  async save(restaurantId, week, changes) {
    await this.wait(this.delayMs * 1.8 + 300);
    if (this.failNextSave) { this.failNextSave = false; throw new Error('Demo server rejected this save. Your choices are kept.'); }
    const foods = this.foods(restaurantId, week);
    const next = new Set(this.bookings);
    let cost = 0;
    for (const change of changes) {
      const food = foods.find(item => item.id === change.choice.id);
      if (!food || food.locked) throw new Error('A selected food is no longer available. Your choices are kept.');
      cost += (Number(change.desired) - Number(next.has(food.id))) * food.priceRials;
      if (change.desired) next.add(food.id); else next.delete(food.id);
    }
    const quota = new Map();
    for (const id of next) {
      const [rid, date, mealId] = id.split(':');
      const restaurant = RESTAURANTS.find(item => item.id === rid);
      if (!restaurant?.quotaGroup) continue;
      const key = `${slotKey({ date, mealId })}|${restaurant.quotaGroup}`;
      quota.set(key, (quota.get(key) || 0) + 1);
      if (quota.get(key) > 1) throw new Error('Another reservation uses this meal entitlement. Your choices are kept.');
    }
    if (cost > this.balanceRials) throw new Error('Not enough balance. Your choices are kept.');
    this.bookings = next;
    this.balanceRials -= cost;
    return { balanceRials: this.balanceRials };
  }

  exportState() { return { balanceRials: this.balanceRials, bookings: [...this.bookings] }; }
}
