import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DateDivider from './DateDivider';

describe('DateDivider', () => {
  it('renders "Today" for today\'s date', () => {
    const today = new Date();
    render(<DateDivider date={today} />);
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('renders "Yesterday" for yesterday\'s date', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    render(<DateDivider date={yesterday} />);
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('renders formatted date for older dates', () => {
    const oldDate = new Date('2024-01-15');
    render(<DateDivider date={oldDate} />);
    expect(screen.getByText(/Jan 1[45]/)).toBeInTheDocument();
  });

  it('includes year for dates from different years', () => {
    const oldDate = new Date('2023-01-15');
    render(<DateDivider date={oldDate} />);
    expect(screen.getByText(/2023/)).toBeInTheDocument();
  });
});
