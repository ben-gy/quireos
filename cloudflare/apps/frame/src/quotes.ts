/** Twenty public-domain quotes (all authors died before 1931). */
export interface Quote {
  text: string;
  author: string;
}

export const QUOTES: Quote[] = [
  { text: "The happiness of your life depends upon the quality of your thoughts.", author: "Marcus Aurelius" },
  { text: "It is not that we have a short time to live, but that we waste a lot of it.", author: "Seneca" },
  { text: "It's not what happens to you, but how you react to it that matters.", author: "Epictetus" },
  { text: "A journey of a thousand miles begins with a single step.", author: "Lao Tzu" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "We know what we are, but know not what we may be.", author: "William Shakespeare" },
  { text: "What lies behind us and what lies before us are tiny matters compared to what lies within us.", author: "Ralph Waldo Emerson" },
  { text: "Go confidently in the direction of your dreams. Live the life you have imagined.", author: "Henry David Thoreau" },
  { text: "Keep your face always toward the sunshine, and shadows will fall behind you.", author: "Walt Whitman" },
  { text: "Hope is the thing with feathers that perches in the soul.", author: "Emily Dickinson" },
  { text: "There is no charm equal to tenderness of heart.", author: "Jane Austen" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Well done is better than well said.", author: "Benjamin Franklin" },
  { text: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Aristotle" },
  { text: "The beginning is the most important part of the work.", author: "Plato" },
  { text: "The unexamined life is not worth living.", author: "Socrates" },
  { text: "The greatest thing in the world is to know how to belong to oneself.", author: "Michel de Montaigne" },
  { text: "Be yourself; everyone else is already taken.", author: "Oscar Wilde" },
  { text: "He who has a why to live can bear almost any how.", author: "Friedrich Nietzsche" },
];

/** Picks a quote for a seed (negative seeds wrap). */
export function quoteFor(seed: number): Quote {
  const n = QUOTES.length;
  return QUOTES[((Math.trunc(seed) % n) + n) % n]!;
}
