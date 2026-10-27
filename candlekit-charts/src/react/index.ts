/**
 * @getcandlekit/charts/react — React bindings.
 *
 * Re-exports the core surface plus the React components/hooks so consumers can
 * import everything from one place when using React.
 */

export * from "../index";

export { ChartView, type ChartViewProps } from "./ChartView";
export { DrawingToolbar, type DrawingToolbarProps } from "./DrawingToolbar";
export { IndicatorPicker, type IndicatorPickerProps } from "./IndicatorPicker";
export { IndicatorModal, type IndicatorModalProps } from "./IndicatorModal";
export { IndicatorQuickPanel, type IndicatorQuickPanelProps } from "./IndicatorQuickPanel";
export { IndicatorSettingsDialog, type IndicatorSettingsDialogProps } from "./IndicatorSettingsDialog";
export { ChartLegend, type ChartLegendProps } from "./ChartLegend";
export {
  useIndicatorPrefs,
  getFavorites as getIndicatorFavorites,
  getRecents as getIndicatorRecents,
  toggleFavorite as toggleIndicatorFavorite,
  type IndicatorPrefs,
} from "./indicatorPrefs";
export { MeasurementOverlay, type MeasurementOverlayProps } from "./MeasurementOverlay";
export { ReplayControls, type ReplayControlsProps } from "./ReplayControls";
export { SplitPane, type SplitPaneProps } from "./SplitPane";
export { useChartController } from "./hooks/useChartController";
export { usePageTheme, type PageTheme } from "./hooks/usePageTheme";
export { ChartContext, useChartApi, useChartApiOptional, type ChartViewApi } from "./context";
