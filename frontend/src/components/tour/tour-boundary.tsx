'use client'
// A failure inside the tour (a render error, a chunk that did not load) must never take the app with it: the tour sits in the
// root layout, above every route, and the app has no other error boundary at that level. Once anything below throws, this
// renders nothing, and the write guard is released so nobody is left locked out.
import { Component, type ReactNode } from 'react'
import { setTourOpen } from './guard'

export class TourBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(): void {
    setTourOpen(false)
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
