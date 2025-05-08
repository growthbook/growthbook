import React, { useState } from 'react';
import ScatterPlotGraph, { ScatterPointData } from '@/components/ScatterPlotGraph';
import {ร้อนแรงMetricSelector } from '@/components/Experiment/MetricSelector'; // Assuming MetricSelector can be used
import { Button } from '@/components/Radix/Button'; // Example Radix component
import { Container, Section, Heading } from '@/components/Radix/Layout'; // Example Radix layout components

// Placeholder data - you will replace this later
const sampleCorrelationData: ScatterPointData[] = [
  // { id: '1', x: 10, y: 20, xmin: 8, xmax: 12, ymin: 18, ymax: 22, units: 100, experimentName: 'Corr Test 1', xMetricName: 'Metric X', yMetricName: 'Metric Y' },
  // { id: '2', x: 15, y: 25, xmin: 13, xmax: 17, ymin: 23, ymax: 27, units: 150, experimentName: 'Corr Test 2', xMetricName: 'Metric X', yMetricName: 'Metric Y' },
];

const MetricCorrelationsPage: React.FC = () => {
  const [metric1, setMetric1] = useState<string>('');
  const [metric2, setMetric2] = useState<string>('');
  const [correlationData, setCorrelationData] = useState<ScatterPointData[]>(sampleCorrelationData);
  const [loading, setLoading] = useState<boolean>(false);

  const handleFetchCorrelations = async () => {
    if (!metric1 || !metric2) {
      alert('Please select two metrics.');
      return;
    }
    setLoading(true);
    // In a real scenario, you would fetch data based on metric1 and metric2
    // For now, we'll just simulate a delay and use sample data or clear it
    console.log(`Fetching correlations for ${metric1} and ${metric2}`);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
    // Replace with actual data fetching logic
    // For example:
    // const fetchedData = await fetchCorrelationData(metric1, metric2);
    // setCorrelationData(fetchedData);
    setCorrelationData(sampleCorrelationData); // or [] if you want to clear
    setLoading(false);
  };

  return (
    <Container>
      <Section>
        <Heading as="h1" size="xl" className="mb-4">Metric Correlations</Heading>
        <div className="row mb-4 align-items-end">
          <div className="col-md-4">
            <label htmlFor="metric1-selector" className="form-label">Metric 1 (X-axis)</label>
            {/* <MetricSelector
              value={metric1}
              onChange={setMetric1}
              // projects={[]} // Pass projects if needed
              // includeFacts={true} // Pass if needed
              id="metric1-selector"
            /> */}
            <p>Metric Selector 1 Placeholder</p> {/* Placeholder */}
          </div>
          <div className="col-md-4">
            <label htmlFor="metric2-selector" className="form-label">Metric 2 (Y-axis)</label>
            {/* <MetricSelector
              value={metric2}
              onChange={setMetric2}
              // projects={[]} // Pass projects if needed
              // includeFacts={true} // Pass if needed
              id="metric2-selector"
            /> */}
            <p>Metric Selector 2 Placeholder</p> {/* Placeholder */}
          </div>
          <div className="col-md-auto">
            <Button
              onClick={handleFetchCorrelations}
              disabled={loading || !metric1 || !metric2}
              color="primary"
            >
              {loading ? 'Loading...' : 'View Correlation'}
            </Button>
          </div>
        </div>

        {loading && <p>Loading chart data...</p>}
        {!loading && correlationData.length === 0 && (
          <div className="alert alert-info">
            Select two metrics and click "View Correlation" to see the data.
            {metric1 && metric2 && " (No data available for the selected metric pair or date range)"}
          </div>
        )}
        {!loading && correlationData.length > 0 && (
          <div style={{ width: '100%', height: '600px', border: '1px solid #ccc' }}>
            <ScatterPlotGraph
              data={correlationData}
              width={800} // These should ideally be responsive
              height={600}
            />
          </div>
        )}
      </Section>
    </Container>
  );
};

export default MetricCorrelationsPage; 