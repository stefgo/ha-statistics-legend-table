/**
 * Legend styling, ported from the custom legend of energy-graph-cards
 * (energy-usage-graph-card.ts) and extended for multiple value columns.
 */

import { css } from "lit";

export const legendStyles = css`
  ha-card {
    height: 100%;
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 0;
  }
  .notice {
    padding: 16px;
    color: var(--secondary-text-color);
  }
  .legend {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 0 16px 16px;
    margin-top: 8px;
  }
  .legend-group {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .legend-group-title {
    font-size: 12px;
    color: var(--secondary-text-color);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .legend-item {
    display: grid;
    grid-template-columns: var(--ecl-columns, 52px 1fr auto);
    align-items: center;
    gap: 12px;
    font-size: 14px;
    cursor: pointer;
    user-select: none;
    transition: opacity 0.2s;
  }
  .legend-headers {
    display: grid;
    grid-template-columns: var(--ecl-columns, 52px 1fr auto);
    align-items: center;
    gap: 12px;
    font-size: 12px;
    color: var(--secondary-text-color);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .legend-item.hidden {
    opacity: 0.5;
  }
  .legend-item.hidden .legend-name,
  .legend-item.hidden .legend-value {
    color: var(--secondary-text-color);
  }
  .legend-icon {
    width: 32px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid;
    display: block;
    transition: background-color 0.2s;
  }
  .legend-name {
    color: var(--primary-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .legend-value {
    color: var(--primary-text-color);
    font-weight: var(--ha-font-weight-normal);
    white-space: nowrap;
    text-align: right;
  }
  .legend-total {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 12px;
    font-size: 14px;
    padding-top: 12px;
    padding-left: 64px;
    border-top: 1px solid var(--divider-color);
  }
  .legend-total .legend-name {
    font-weight: var(--ha-font-weight-medium);
  }
  .legend-total .legend-value {
    font-weight: var(--ha-font-weight-medium);
  }

  /* Narrow cards: the value columns wrap below the series name */
  @media (max-width: 400px) {
    .legend-headers {
      display: none;
    }
    .legend-item {
      grid-template-columns: 52px 1fr;
      row-gap: 2px;
    }
    .legend-item .legend-value {
      grid-column: 2;
      text-align: left;
      color: var(--secondary-text-color);
    }
  }
`;
