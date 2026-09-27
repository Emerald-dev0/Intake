import { motion } from 'motion/react';
import type { ReactNode } from 'react';

export function SectionHead({ n, kicker, title, lede, center = false }: { n: string; kicker: string; type?: string; title: ReactNode; lede?: ReactNode; center?: boolean }) {
  return (
    <motion.div
      className={`sh ${center ? 'is-center' : ''}`}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="sh-eyebrow">
        <span className="sh-n" data-n={n} />
        <span className="sh-k">{kicker}</span>
        <span className="sh-req">*</span>
      </div>
      <h2 className="sh-title">{title}</h2>
      {lede && <p className="sh-lede">{lede}</p>}
    </motion.div>
  );
}

export function Reveal({ children, delay = 0, y = 24, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
