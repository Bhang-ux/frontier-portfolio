import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/ui/primitives';

export default function NotFoundPage() {
  return (
    <div className="card mx-auto mt-10 max-w-xl">
      <EmptyState icon={<Compass size={32} />} title="This page wandered off the frontier" action={<Link to="/" className="btn-primary">Back to today’s markets</Link>}>
        The link may be old or mistyped. Everything Frontier offers is in the menu.
      </EmptyState>
    </div>
  );
}
