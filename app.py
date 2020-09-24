from flask import Flask, render_template
from config import Config

app = Flask(__name__)
app.config.from_object(Config)


@app.route('/')
@app.route('/index')
def index():
    patterns = [
        ['RLRLRLRL', 'RLRLRLRL'],  # 1
        ['LRLRLRLR', 'LRLRLRLR'],  # 2
        ['RRLLRRLL', 'RRLLRRLL'],  # 3
        ['LLRRLLRR', 'LLRRLLRR'],  # 4
        ['RLRRLRLL', 'RLRRLRLL'],  # 5
        ['RLLRLRRL', 'RLLRLRRL'],  # 6
        ['RRLRLLRL', 'RRLRLLRL'],  # 7
        ['RLRLLRLR', 'RLRLLRLR'],  # 8
        ['RRRLRRRL', 'RRRLRRRL'],  # 9
        ['LLLRLLLR', 'LLLRLLLR'],  # 10
        ['RLLLRLLL', 'RLLLRLLL'],  # 11
        ['LRRRLRRR', 'LRRRLRRR'],  # 12
        ['RRRRLLLL', 'RRRRLLLL'],  # 13
        ['RLRLRRLL', 'RLRLRRLL'],  # 14
        ['LRLRLLRR', 'LRLRLLRR'],  # 15
        ['RLRLRLRR', 'LRLRLRLL'],  # 16
        ['RLRLRLLR', 'LRLRLRRL'],  # 17
        ['RLRLRRLR', 'LRLRLLRL'],  # 18
        ['RLRLRRRL', 'RLRLRRRL'],  # 19
        ['LRLRLLLR', 'LRLRLLLR'],  # 20
        ['RLRLRLLL', 'RLRLRLLL'],  # 21
        ['LRLRLRRR', 'LRLRLRRR'],  # 22
        ['RLRLRRRR', 'LRLRLLLL'],  # 23
        ['RRLLRLRR', 'LLRRLRLL'],  # 24
    ]
    return render_template('index.html', title='Home', patterns=patterns)
