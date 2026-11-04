import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { PageLoading } from './components/domain/common';
import { ErrorBoundary } from './components/domain/ErrorBoundary';

const Today = lazy(() => import('./pages/Today'));
const Advisor = lazy(() => import('./pages/Advisor'));
const PortfolioPage = lazy(() => import('./pages/Portfolio'));
const Optimize = lazy(() => import('./pages/Optimize'));
const Simulate = lazy(() => import('./pages/Simulate'));
const Backtest = lazy(() => import('./pages/Backtest'));
const Markets = lazy(() => import('./pages/Markets'));
const Asset = lazy(() => import('./pages/Asset'));
const Learn = lazy(() => import('./pages/Learn'));
const NotFound = lazy(() => import('./pages/NotFound'));

const page = (el: ReactNode) => (
  <ErrorBoundary>
    <Suspense fallback={<PageLoading />}>{el}</Suspense>
  </ErrorBoundary>
);

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={page(<Today />)} />
          <Route path="start" element={page(<Advisor />)} />
          <Route path="portfolio" element={page(<PortfolioPage />)} />
          <Route path="optimize" element={page(<Optimize />)} />
          <Route path="simulate" element={page(<Simulate />)} />
          <Route path="backtest" element={page(<Backtest />)} />
          <Route path="markets" element={page(<Markets />)} />
          <Route path="asset/:id" element={page(<Asset />)} />
          <Route path="learn" element={page(<Learn />)} />
          <Route path="*" element={page(<NotFound />)} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
