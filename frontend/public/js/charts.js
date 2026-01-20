// charts.js - Chart rendering using Chart.js

/**
 * Render Sprint Report Chart
 */
let sprintChartInstance = null; // Track chart instance

window.renderSprintChart = function (data) {
    const ctx = document.getElementById('sprint-chart');
    if (!ctx) return;

    // Destroy previous chart instance to prevent memory leaks and errors
    if (sprintChartInstance) {
        sprintChartInstance.destroy();
        sprintChartInstance = null;
    }

    // Group data by sprint
    const sprints = {};
    data.forEach(row => {
        if (!sprints[row.sprint]) {
            sprints[row.sprint] = {
                confirmed: 0,
                unconfirmed: 0
            };
        }
        sprints[row.sprint].confirmed += row.confirmed_points;
        sprints[row.sprint].unconfirmed += row.unconfirmed_points;
    });

    const labels = Object.keys(sprints);
    const confirmedData = labels.map(sprint => sprints[sprint].confirmed);
    const unconfirmedData = labels.map(sprint => sprints[sprint].unconfirmed);

    sprintChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Confirmed Points',
                    data: confirmedData,
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderColor: 'rgba(16, 185, 129, 1)',
                    borderWidth: 2
                },
                {
                    label: 'Unconfirmed Points',
                    data: unconfirmedData,
                    backgroundColor: 'rgba(245, 158, 11, 0.8)',
                    borderColor: 'rgba(245, 158, 11, 1)',
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#a0a0c0',
                        font: {
                            family: 'Inter',
                            size: 12
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(26, 26, 46, 0.95)',
                    titleColor: '#ffffff',
                    bodyColor: '#a0a0c0',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true
                }
            },
            scales: {
                x: {
                    stacked: false,
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#a0a0c0',
                        font: {
                            family: 'Inter'
                        }
                    }
                },
                y: {
                    stacked: false,
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        borderDash: [5, 5]
                    },
                    ticks: {
                        color: '#a0a0c0',
                        font: {
                            family: 'Inter'
                        }
                    }
                }
            }
        }
    });
};

/**
 * Render Productivity Report Chart
 */
let productivityChartInstance = null; // Track chart instance

window.renderProductivityChart = function (data) {
    const ctx = document.getElementById('productivity-chart');
    if (!ctx) return;

    // Destroy previous chart instance
    if (productivityChartInstance) {
        productivityChartInstance.destroy();
        productivityChartInstance = null;
    }

    const labels = data.map(row => row.assignee);
    const productivityData = data.map(row => row.productivity_percentage);

    // Generate colors
    const colors = labels.map((_, index) => {
        const hue = (index * 360 / labels.length) % 360;
        return `hsla(${hue}, 70%, 60%, 0.8)`;
    });

    const borderColors = labels.map((_, index) => {
        const hue = (index * 360 / labels.length) % 360;
        return `hsla(${hue}, 70%, 60%, 1)`;
    });

    productivityChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                label: 'Productivity %',
                data: productivityData,
                backgroundColor: colors,
                borderColor: borderColors,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            plugins: {
                legend: {
                    display: true,
                    position: 'right',
                    labels: {
                        color: '#a0a0c0',
                        font: {
                            family: 'Inter',
                            size: 12
                        },
                        padding: 15,
                        generateLabels: function (chart) {
                            const data = chart.data;
                            return data.labels.map((label, i) => {
                                const value = data.datasets[0].data[i];
                                return {
                                    text: `${label}: ${value}%`,
                                    fillStyle: data.datasets[0].backgroundColor[i],
                                    strokeStyle: data.datasets[0].borderColor[i],
                                    lineWidth: 2,
                                    hidden: false,
                                    index: i
                                };
                            });
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(26, 26, 46, 0.95)',
                    titleColor: '#ffffff',
                    bodyColor: '#a0a0c0',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: function (context) {
                            return `${context.label}: ${context.parsed}%`;
                        }
                    }
                }
            }
        }
    });
};
