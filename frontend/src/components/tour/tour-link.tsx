'use client'
// A button that starts the tour from a page (About). The host does the rest: it takes the visitor to the first stop.
import { CompassIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { openTour } from './store'

export function TourLink() {
  return (
    <Button variant="outline" size="lg" className="w-fit pointer-coarse:h-11" onClick={openTour}>
      <CompassIcon /> Take the tour
    </Button>
  )
}
